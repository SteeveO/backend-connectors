import { Account, Transaction } from '../entities';
import { BankPort } from '../ports/bank.port';
import { AggregateAccountsUseCase } from './aggregate-accounts.use-case';

describe('AggregateAccountsUseCase', () => {
  const ACCESS_TOKEN = 'access-token';

  function createBankPortMock(): jest.Mocked<BankPort> {
    return {
      login: jest.fn(),
      getAccounts: jest.fn(),
      getTransactions: jest.fn(),
    };
  }

  it('logs in, fetches accounts and aggregates their transactions', async () => {
    const bankPort = createBankPortMock();
    const accounts: Account[] = [
      { accNumber: '001', amount: 100, currency: 'EUR' },
      { accNumber: '002', amount: 200, currency: 'EUR' },
    ];
    const transactionsByAccount: Record<string, Transaction[]> = {
      '001': [{ id: 't1', label: 'Coffee', amount: -3, currency: 'EUR' }],
      '002': [{ id: 't2', label: 'Salary', amount: 2000, currency: 'EUR' }],
    };
    bankPort.login.mockResolvedValue(ACCESS_TOKEN);
    bankPort.getAccounts.mockResolvedValue(accounts);
    bankPort.getTransactions.mockImplementation((_token, accNumber) =>
      Promise.resolve(transactionsByAccount[accNumber]),
    );

    const result = await new AggregateAccountsUseCase(bankPort).execute();

    expect(bankPort.login).toHaveBeenCalledTimes(1);
    expect(bankPort.getAccounts).toHaveBeenCalledWith(ACCESS_TOKEN);
    expect(result).toEqual([
      {
        accNumber: '001',
        amount: 100,
        transactions: transactionsByAccount['001'],
      },
      {
        accNumber: '002',
        amount: 200,
        transactions: transactionsByAccount['002'],
      },
    ]);
  });

  it('associates each account with its own transactions, never another account’s', async () => {
    const bankPort = createBankPortMock();
    bankPort.login.mockResolvedValue(ACCESS_TOKEN);
    bankPort.getAccounts.mockResolvedValue([
      { accNumber: 'A', amount: 1, currency: 'EUR' },
      { accNumber: 'B', amount: 2, currency: 'EUR' },
    ]);
    bankPort.getTransactions.mockImplementation((_token, accNumber) =>
      Promise.resolve([
        { id: `tx-${accNumber}`, label: accNumber, amount: 1, currency: 'EUR' },
      ]),
    );

    const result = await new AggregateAccountsUseCase(bankPort).execute();

    expect(result.find((a) => a.accNumber === 'A')?.transactions).toEqual([
      { id: 'tx-A', label: 'A', amount: 1, currency: 'EUR' },
    ]);
    expect(result.find((a) => a.accNumber === 'B')?.transactions).toEqual([
      { id: 'tx-B', label: 'B', amount: 1, currency: 'EUR' },
    ]);
  });

  it('fetches transactions for every account in parallel rather than sequentially', async () => {
    const bankPort = createBankPortMock();
    bankPort.login.mockResolvedValue(ACCESS_TOKEN);
    bankPort.getAccounts.mockResolvedValue([
      { accNumber: '001', amount: 1, currency: 'EUR' },
      { accNumber: '002', amount: 1, currency: 'EUR' },
      { accNumber: '003', amount: 1, currency: 'EUR' },
    ]);

    let inFlight = 0;
    let maxInFlight = 0;
    bankPort.getTransactions.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return [];
    });

    await new AggregateAccountsUseCase(bankPort).execute();

    expect(maxInFlight).toBe(3);
  });

  it('returns an account with an empty transaction list when it has none', async () => {
    const bankPort = createBankPortMock();
    bankPort.login.mockResolvedValue(ACCESS_TOKEN);
    bankPort.getAccounts.mockResolvedValue([
      { accNumber: '001', amount: 0, currency: 'EUR' },
    ]);
    bankPort.getTransactions.mockResolvedValue([]);

    const result = await new AggregateAccountsUseCase(bankPort).execute();

    expect(result).toEqual([{ accNumber: '001', amount: 0, transactions: [] }]);
  });

  it('propagates the error when login fails', async () => {
    const bankPort = createBankPortMock();
    const loginError = new Error('login failed');
    bankPort.login.mockRejectedValue(loginError);

    await expect(
      new AggregateAccountsUseCase(bankPort).execute(),
    ).rejects.toThrow(loginError);
    expect(bankPort.getAccounts).not.toHaveBeenCalled();
    expect(bankPort.getTransactions).not.toHaveBeenCalled();
  });
});
