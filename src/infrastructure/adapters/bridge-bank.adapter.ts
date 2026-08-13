import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { Account, Transaction } from '../../domain/entities';
import { BankPort } from '../../domain/ports/bank.port';
import {
  BridgeAccount,
  BridgeAccountsResponse,
  BridgeLoginResponse,
  BridgeTokenResponse,
  BridgeTransaction,
  BridgeTransactionsResponse,
} from './bridge-bank.types';

@Injectable()
export class BridgeBankAdapter implements BankPort {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly username: string;
  private readonly password: string;

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService,
  ) {
    this.baseUrl = configService.getOrThrow<string>('BANK_URL');
    this.clientId = configService.getOrThrow<string>('BANK_CLIENT_ID');
    this.clientSecret = configService.getOrThrow<string>('BANK_CLIENT_SECRET');
    this.username = configService.getOrThrow<string>('BANK_LOGIN');
    this.password = configService.getOrThrow<string>('BANK_PASSWORD');
  }

  async login(): Promise<string> {
    const basicAuth = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString('base64');
    const { data: loginData } = await firstValueFrom(
      this.httpService.post<BridgeLoginResponse>(
        `${this.baseUrl}/login`,
        { user: this.username, password: this.password },
        { headers: { Authorization: `Basic ${basicAuth}` } },
      ),
    );

    const { data: tokenData } = await firstValueFrom(
      this.httpService.post<BridgeTokenResponse>(`${this.baseUrl}/token`, {
        grant_type: 'refresh_token',
        refresh_token: loginData.refresh_token,
      }),
    );

    return tokenData.access_token;
  }

  async getAccounts(accessToken: string): Promise<Account[]> {
    const accounts: Account[] = [];
    let path: string | null = '/accounts';

    while (path) {
      const response: AxiosResponse<BridgeAccountsResponse> =
        await firstValueFrom(
          this.httpService.get<BridgeAccountsResponse>(
            `${this.baseUrl}${path}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            },
          ),
        );
      accounts.push(...response.data.account.map(mapAccount));
      path = response.data.link.next;
    }

    return accounts;
  }

  async getTransactions(
    accessToken: string,
    accNumber: string,
  ): Promise<Transaction[]> {
    const transactions: Transaction[] = [];
    let path: string | null = `/accounts/${accNumber}/transactions`;

    while (path) {
      const response: AxiosResponse<BridgeTransactionsResponse> =
        await firstValueFrom(
          this.httpService.get<BridgeTransactionsResponse>(
            `${this.baseUrl}${path}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            },
          ),
        );
      transactions.push(...response.data.transactions.map(mapTransaction));
      path = response.data.link.next;
    }

    return dedupeById(transactions);
  }
}

function mapAccount(account: BridgeAccount): Account {
  return {
    accNumber: account.acc_number,
    amount: Number(account.amount),
    currency: account.currency,
  };
}

function mapTransaction(transaction: BridgeTransaction): Transaction {
  const sign = transaction.sign === 'DBT' ? -1 : 1;

  return {
    id: String(transaction.id),
    label: transaction.label,
    amount: Number(transaction.amount) * sign,
    currency: transaction.currency,
  };
}

function dedupeById(transactions: Transaction[]): Transaction[] {
  return [
    ...new Map(
      transactions.map((transaction) => [transaction.id, transaction]),
    ).values(),
  ];
}
