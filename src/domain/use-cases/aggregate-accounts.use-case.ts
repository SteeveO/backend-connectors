import { AggregatedAccount } from '../entities';
import { BankPort } from '../ports/bank.port';

export class AggregateAccountsUseCase {
  constructor(private readonly bankPort: BankPort) {}

  async execute(): Promise<AggregatedAccount[]> {
    const accessToken = await this.bankPort.login();
    const accounts = await this.bankPort.getAccounts(accessToken);

    const results = await Promise.allSettled(
      accounts.map((account) =>
        this.bankPort.getTransactions(accessToken, account.accNumber),
      ),
    );

    return accounts.map((account, index) => {
      const result = results[index];

      if (result.status === 'rejected') {
        console.error(
          `Failed to fetch transactions for account ${account.accNumber}, returning it with no transactions`,
          result.reason,
        );
      }

      return {
        accNumber: account.accNumber,
        amount: account.amount,
        transactions: result.status === 'fulfilled' ? result.value : [],
      };
    });
  }
}
