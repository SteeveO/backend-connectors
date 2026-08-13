import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { Account, Transaction } from '../domain/entities';
import { BankAuthenticationException } from '../domain/exceptions/bank-authentication.exception';
import { BankUnavailableException } from '../domain/exceptions/bank-unavailable.exception';
import { BANK_PORT, BankPort } from '../domain/ports/bank.port';
import { AggregatedAccountDto } from './dto/aggregated-account.dto';
import { ErrorResponseDto } from './dto/error-response.dto';
import { AppModule } from './app.module';

function createFakeBankPort(): jest.Mocked<BankPort> {
  return {
    login: jest.fn(),
    getAccounts: jest.fn(),
    getTransactions: jest.fn(),
  };
}

describe('AppController (integration)', () => {
  let app: INestApplication<App>;
  let bankPort: jest.Mocked<BankPort>;

  beforeAll(async () => {
    bankPort = createFakeBankPort();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BANK_PORT)
      .useValue(bankPort)
      .compile();

    app = moduleFixture.createNestApplication();
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Bridge Backend Connectors')
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    bankPort.login.mockReset().mockResolvedValue('fake-access-token');
    bankPort.getAccounts.mockReset();
    bankPort.getTransactions.mockReset();
  });

  it('aggregates accounts and passes each account transactions through untouched', async () => {
    const accounts: Account[] = [
      { accNumber: '001', amount: 100, currency: 'EUR' },
      { accNumber: '002', amount: 200, currency: 'EUR' },
    ];
    // Already deduplicated, as guaranteed by the BankPort contract (BridgeBankAdapter
    // dedupes before returning) -- this checks the controller/use-case pass this through
    // untouched rather than reintroducing duplicates.
    const transactionsByAccount: Record<string, Transaction[]> = {
      '001': [{ id: '1', label: 'Coffee', amount: -3, currency: 'EUR' }],
      '002': [],
    };
    bankPort.getAccounts.mockResolvedValue(accounts);
    bankPort.getTransactions.mockImplementation((_token, accNumber) =>
      Promise.resolve(transactionsByAccount[accNumber]),
    );

    const response = await request(app.getHttpServer())
      .get('/aggregated-accounts')
      .expect(200);

    expect(response.body as AggregatedAccountDto[]).toEqual([
      {
        accNumber: '001',
        amount: 100,
        transactions: transactionsByAccount['001'],
      },
      { accNumber: '002', amount: 200, transactions: [] },
    ]);
  });

  it('isolates an account whose transactions fail to load instead of failing the whole request', async () => {
    bankPort.getAccounts.mockResolvedValue([
      { accNumber: '001', amount: 100, currency: 'EUR' },
      { accNumber: 'broken', amount: 50, currency: 'EUR' },
    ]);
    bankPort.getTransactions.mockImplementation((_token, accNumber) =>
      accNumber === 'broken'
        ? Promise.reject(new Error('Account not found'))
        : Promise.resolve([
            { id: '1', label: 'Coffee', amount: -3, currency: 'EUR' },
          ]),
    );

    const response = await request(app.getHttpServer())
      .get('/aggregated-accounts')
      .expect(200);

    expect(response.body as AggregatedAccountDto[]).toEqual([
      {
        accNumber: '001',
        amount: 100,
        transactions: [
          { id: '1', label: 'Coffee', amount: -3, currency: 'EUR' },
        ],
      },
      { accNumber: 'broken', amount: 50, transactions: [] },
    ]);
  });

  it('exposes the Swagger documentation on /api/docs', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs')
      .expect(200);

    expect(response.text).toContain('swagger');
  });

  describe('error handling', () => {
    it('maps a BankAuthenticationException to a structured 401 response', async () => {
      bankPort.login.mockRejectedValue(
        new BankAuthenticationException('Invalid credentials'),
      );

      const response = await request(app.getHttpServer())
        .get('/aggregated-accounts')
        .expect(401);
      const body = response.body as ErrorResponseDto;

      expect(body.statusCode).toBe(401);
      expect(body.message).toBe('Invalid credentials');
      expect(body.path).toBe('/aggregated-accounts');
      expect(typeof body.timestamp).toBe('string');
    });

    it('maps a BankUnavailableException to a structured 503 response', async () => {
      bankPort.login.mockRejectedValue(
        new BankUnavailableException('Bridge is unreachable'),
      );

      const response = await request(app.getHttpServer())
        .get('/aggregated-accounts')
        .expect(503);
      const body = response.body as ErrorResponseDto;

      expect(body.statusCode).toBe(503);
      expect(body.message).toBe('Bridge is unreachable');
      expect(body.path).toBe('/aggregated-accounts');
    });

    it('maps an unexpected error to a structured, non-leaking 500 response', async () => {
      bankPort.login.mockRejectedValue(new Error('some internal detail'));

      const response = await request(app.getHttpServer())
        .get('/aggregated-accounts')
        .expect(500);
      const body = response.body as ErrorResponseDto;

      expect(body.statusCode).toBe(500);
      expect(body.message).toBe('Internal server error');
      expect(body.path).toBe('/aggregated-accounts');
    });
  });
});
