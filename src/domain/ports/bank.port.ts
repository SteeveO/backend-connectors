import { Account, Transaction } from '../entities';

export const BANK_PORT = Symbol('BankPort');

export interface BankPort {
  login(): Promise<string>;
  getAccounts(accessToken: string): Promise<Account[]>;
  getTransactions(
    accessToken: string,
    accNumber: string,
  ): Promise<Transaction[]>;
}
