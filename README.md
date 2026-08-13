# Bridge Backend Connectors

[![CI](https://github.com/SteeveO/backend-connectors/actions/workflows/ci.yml/badge.svg)](https://github.com/SteeveO/backend-connectors/actions/workflows/ci.yml)

Connecteur bancaire qui s'authentifie auprès du mock server Bridge, agrège les comptes et transactions d'un utilisateur (avec pagination et déduplication), et expose le résultat via un unique endpoint REST documenté sur Swagger.

## Démarrage rapide

Trois commandes :

```bash
git clone git@github.com:SteeveO/backend-connectors.git && cd backend-connectors
cp .env.example .env
docker-compose up
```

| Service | URL |
| --- | --- |
| API (endpoint agrégé) | http://localhost:3001/aggregated-accounts |
| Documentation Swagger | http://localhost:3001/api/docs |
| Mock server Bridge | http://localhost:3000 |

## Contexte

Ce projet est une réponse approfondie au [test technique Bridge](https://github.com/BridgeAPI/technical-test-node). L'objectif original était un script orchestrant des appels au mock server bancaire pour agréger comptes et transactions d'un utilisateur. Ce dépôt va plus loin en implémentant la même logique dans une architecture propre et testée : archi hexagonale, tests unitaires et d'intégration, gestion d'erreur centralisée, documentation Swagger et containerisation.

**Avec plus de temps**, les points suivants seraient à creuser :

- **Authentification par requête** : `login()` refait le cycle `POST /login` → `POST /token` à chaque appel de `AggregateAccountsUseCase.execute()`. Un cache d'access token avec gestion d'expiration (et refresh transparent) éviterait cet aller-retour systématique.
- **Observabilité** : l'isolation d'erreur par compte (voir plus bas) journalise sur `console.error` faute de logger structuré ; un vrai logger (avec niveau, corrélation par requête) serait injecté via un port dédié plutôt que d'utiliser une dépendance globale dans le domaine.
- **Rate limiting / retry** : aucun retry ni backoff sur les appels à Bridge ; en production, une panne transitoire du fournisseur ferait actuellement échouer ou vider une requête entière au lieu de réessayer.
- **Tests de charge sur la pagination** : le mock expose des comptes/transactions sur un nombre de pages volontairement élevé (voir plus bas) ; le comportement de l'adaptateur sur un vrai volume de production (des milliers de comptes) n'est validé que par lecture de code, pas par un test de charge.

## Architecture

Le projet suit une architecture hexagonale (ports & adapters) :

```
src/
├── domain/
│   ├── entities/       # Types métier purs : Account, Transaction, AggregatedAccount
│   ├── ports/           # BankPort : l'interface dont le domaine a besoin
│   ├── use-cases/       # AggregateAccountsUseCase : orchestration, aucune I/O directe
│   └── exceptions/      # BankAuthenticationException, BankUnavailableException
├── infrastructure/
│   └── adapters/        # BridgeBankAdapter : implémente BankPort via HTTP
└── app/
    ├── app.controller.ts   # GET /aggregated-accounts
    ├── app.module.ts       # Câblage DI : BridgeBankAdapter -> BankPort
    ├── dto/                 # DTOs Swagger
    └── filters/             # AllExceptionsFilter : erreurs -> réponses structurées
```

Le domaine ne sait pas qu'il parle à un serveur HTTP : il dépend uniquement de l'interface `BankPort`. `BridgeBankAdapter` est la seule couche qui connaît les détails du mock server Bridge (URLs, pagination, format des réponses) ; ses types internes (`BridgeAccountsResponse`, etc.) ne sont jamais exposés au-delà de ce fichier. `AppModule` est le seul endroit où domaine et infrastructure se rencontrent, via l'injection de dépendances NestJS (`BankPort` est un token `Symbol` puisque les interfaces TypeScript n'existent plus au runtime).

### Pourquoi une architecture hexagonale ici

Le test technique original ne demande qu'un script d'agrégation. Une archi hexagonale est volontairement disproportionnée pour ce besoin seul, mais elle sert ici à démontrer une séparation stricte domaine/infrastructure : le use case et les entités se testent sans aucun appel HTTP (mocks du port), l'adaptateur se teste sans dépendre du mock server (axios mocké), et le seul test qui parle réellement HTTP est le test d'intégration du controller — qui simule lui aussi Bridge plutôt que de l'appeler (voir plus bas).

### Pagination

`GET /accounts` et `GET /accounts/:acc_number/transactions` sont paginés côté Bridge via `link.next` (une URL relative, ou `null` en fin de pagination). `BridgeBankAdapter` boucle tant que `link.next` n'est pas `null`, sans jamais supposer qu'une seule page suffit. Le mock server fourni pousse volontairement cette pagination loin (jusqu'à 22 pages de comptes), ce qui a permis de vérifier ce comportement en conditions réelles plutôt que seulement sur des mocks.

### Déduplication

Le mock server répète parfois les mêmes transactions d'une page à l'autre (constaté en pratique sur les données fournies). `BridgeBankAdapter.getTransactions()` déduplique par `id` (via une `Map`, qui conserve l'ordre d'insertion) avant de retourner le résultat au domaine — la déduplication est un détail d'infrastructure, le domaine reçoit toujours une liste propre.

### Isolation d'erreur par compte

`AggregateAccountsUseCase.execute()` récupère les transactions de tous les comptes en parallèle via `Promise.allSettled` (et non `Promise.all`) : si un compte échoue (données incohérentes côté Bridge, erreur réseau ponctuelle...), il est retourné avec une liste de transactions vide plutôt que de faire échouer toute l'agrégation. Ce choix a été validé en pratique : les données du mock (`server/myInfos.json`) contiennent une incohérence (un compte listé sous un numéro dans `/accounts` mais indexé différemment dans les transactions), ce qui fait systématiquement échouer l'appel transactions de ce compte précis.

### Gestion d'erreur

`BridgeBankAdapter` convertit toute erreur axios en exception domaine avant qu'elle ne quitte l'adaptateur : un 401 devient `BankAuthenticationException`, une erreur réseau (mock injoignable) devient `BankUnavailableException`, toute autre erreur devient une `Error` avec un message nettoyé — jamais une erreur axios brute ne remonte au domaine. `AllExceptionsFilter`, enregistré globalement via le provider `APP_FILTER`, transforme ces exceptions en réponses JSON structurées :

```json
{
  "statusCode": 401,
  "message": "Bridge authentication failed: 401 Unauthorized",
  "timestamp": "2026-08-13T15:56:22.997Z",
  "path": "/aggregated-accounts"
}
```

| Cause | Code |
| --- | --- |
| `BankAuthenticationException` (identifiants invalides) | 401 |
| `BankUnavailableException` (mock server injoignable) | 503 |
| Toute autre erreur non gérée | 500 |

## Stratégie de test

- **Domaine** (`aggregate-accounts.use-case.spec.ts`) : `BankPort` mocké, aucun appel HTTP.
- **Adaptateur** (`bridge-bank.adapter.spec.ts`) : `HttpService` mocké, aucun appel au mock server réel.
- **Controller / DI** (`app.controller.spec.ts`) : le pipeline complet HTTP → controller → use case → DTO est exercé via `supertest` sur une vraie instance Nest, mais `BankPort` y est remplacé par une implémentation simulée (`overrideProvider`). Le mock server Bridge est traité comme on traiterait une vraie API tierce en production : simulé par la suite de tests, jamais appelé par elle.

Le comportement contre le *vrai* mock server (pagination réelle sur ~22 pages, incohérence de données, dédup de transactions dupliquées, codes 401/503 réels) a été vérifié manuellement pendant le développement plutôt qu'automatisé dans la CI, pour garder la suite de tests rapide et déterministe.

## Variables d'environnement

Voir [`.env.example`](.env.example).

| Variable | Description |
| --- | --- |
| `PORT` | Port d'écoute de l'application (3001 par défaut, différent du mock qui est fixé sur 3000) |
| `BANK_URL` | URL du mock server Bridge |
| `BANK_CLIENT_ID` / `BANK_CLIENT_SECRET` | Identifiants client pour `POST /login` |
| `BANK_LOGIN` / `BANK_PASSWORD` | Identifiants utilisateur pour `POST /login` |

En local avec `docker-compose`, `BANK_URL` est automatiquement réécrit vers `http://mock-server:3000` (le nom du service dans le réseau Docker) ; la valeur de `.env` sert pour un lancement hors containers.

## Commandes disponibles

```bash
npm run start:dev      # Démarre l'application en mode watch
npm run start-server    # Démarre le mock server Bridge (hors Docker)
npm run test             # Tests unitaires + d'intégration
npm run test:cov        # Tests avec couverture
npm run lint              # ESLint (avec --fix)
npm run typecheck       # Vérification TypeScript sans émission
npm run build             # Build de production
```

## Stack technique

NestJS · TypeScript · Jest · Swagger (`@nestjs/swagger`) · Docker / Docker Compose · `@nestjs/config`

## Conventions

- Code, commentaires et commits en anglais ([Conventional Commits](https://www.conventionalcommits.org/))
- Séparation stricte domaine / infrastructure : aucune dépendance HTTP dans `src/domain`
- Aucun secret commité, tout passe par `.env`
