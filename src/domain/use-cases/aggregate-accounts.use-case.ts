import { AggregatedAccount } from '../entities';
import { BankPort } from '../ports/bank.port';

export class AggregateAccountsUseCase {
  constructor(private readonly bankPort: BankPort) {}

  async execute(): Promise<AggregatedAccount[]> {
    const accessToken = await this.bankPort.login();
    const accounts = await this.bankPort.getAccounts(accessToken);

    return Promise.all(
      accounts.map(async (account) => ({
        accNumber: account.accNumber,
        amount: account.amount,
        transactions: await this.bankPort.getTransactions(
          accessToken,
          account.accNumber,
        ),
      })),
    );
  }
}
