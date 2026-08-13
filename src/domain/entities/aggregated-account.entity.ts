import { Transaction } from './transaction.entity';

export interface AggregatedAccount {
  accNumber: string;
  amount: number;
  transactions: Transaction[];
}
