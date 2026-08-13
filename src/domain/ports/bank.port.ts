import { Account, Transaction } from '../entities';

export interface BankPort {
  login(): Promise<string>;
  getAccounts(accessToken: string): Promise<Account[]>;
  getTransactions(
    accessToken: string,
    accNumber: string,
  ): Promise<Transaction[]>;
}
