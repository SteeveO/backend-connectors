import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { BankAuthenticationException } from '../../domain/exceptions/bank-authentication.exception';
import { BankUnavailableException } from '../../domain/exceptions/bank-unavailable.exception';
import { BridgeBankAdapter } from './bridge-bank.adapter';

const ENV = {
  BANK_URL: 'http://localhost:3000',
  BANK_CLIENT_ID: 'BankinClientId',
  BANK_CLIENT_SECRET: 'secret',
  BANK_LOGIN: 'BankinUser',
  BANK_PASSWORD: '12345678',
};

function fakeResponse<T>(data: T): AxiosResponse<T> {
  return { data } as unknown as AxiosResponse<T>;
}

function fakeAxiosError(status: number, statusText: string): AxiosError {
  const response = { status, statusText } as unknown as AxiosResponse;
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    response,
  );
}

function fakeNetworkError(): AxiosError {
  return new AxiosError('connect ECONNREFUSED 127.0.0.1:3000', 'ECONNREFUSED');
}

function createHttpServiceMock(): jest.Mocked<
  Pick<HttpService, 'get' | 'post'>
> {
  return {
    get: jest.fn(),
    post: jest.fn(),
  };
}

function createConfigServiceMock(): { getOrThrow: (key: string) => string } {
  return {
    getOrThrow: (key: string) => ENV[key as keyof typeof ENV],
  };
}

function createAdapter(httpService: ReturnType<typeof createHttpServiceMock>) {
  return new BridgeBankAdapter(
    httpService as unknown as HttpService,
    createConfigServiceMock() as unknown as ConfigService,
  );
}

describe('BridgeBankAdapter', () => {
  describe('login', () => {
    it('exchanges credentials for a refresh token, then a refresh token for an access token', async () => {
      const httpService = createHttpServiceMock();
      httpService.post
        .mockReturnValueOnce(of(fakeResponse({ refresh_token: 'refresh-abc' })))
        .mockReturnValueOnce(of(fakeResponse({ access_token: 'access-xyz' })));

      const accessToken = await createAdapter(httpService).login();

      expect(accessToken).toBe('access-xyz');
      expect(httpService.post).toHaveBeenNthCalledWith(
        1,
        'http://localhost:3000/login',
        { user: 'BankinUser', password: '12345678' },
        {
          headers: {
            Authorization: `Basic ${Buffer.from('BankinClientId:secret').toString('base64')}`,
          },
        },
      );
      expect(httpService.post).toHaveBeenNthCalledWith(
        2,
        'http://localhost:3000/token',
        {
          grant_type: 'refresh_token',
          refresh_token: 'refresh-abc',
        },
      );
    });

    it('converts a 401 from the mock server into a BankAuthenticationException', async () => {
      const httpService = createHttpServiceMock();
      httpService.post.mockReturnValueOnce(
        throwError(() => fakeAxiosError(401, 'Unauthorized')),
      );

      await expect(createAdapter(httpService).login()).rejects.toThrow(
        BankAuthenticationException,
      );
    });

    it('converts a network failure into a BankUnavailableException', async () => {
      const httpService = createHttpServiceMock();
      httpService.post.mockReturnValueOnce(
        throwError(() => fakeNetworkError()),
      );

      await expect(createAdapter(httpService).login()).rejects.toThrow(
        BankUnavailableException,
      );
    });
  });

  describe('getAccounts', () => {
    it('maps a single page of accounts to domain accounts', async () => {
      const httpService = createHttpServiceMock();
      httpService.get.mockReturnValueOnce(
        of(
          fakeResponse({
            account: [{ acc_number: '001', amount: '100', currency: 'EUR' }],
            link: { self: '/accounts?page=1', next: null },
          }),
        ),
      );

      const accounts = await createAdapter(httpService).getAccounts('token-1');

      expect(accounts).toEqual([
        { accNumber: '001', amount: 100, currency: 'EUR' },
      ]);
      expect(httpService.get).toHaveBeenCalledWith(
        'http://localhost:3000/accounts',
        {
          headers: { Authorization: 'Bearer token-1' },
        },
      );
    });

    it('follows pagination links until next is null', async () => {
      const httpService = createHttpServiceMock();
      httpService.get
        .mockReturnValueOnce(
          of(
            fakeResponse({
              account: [{ acc_number: '001', amount: '100', currency: 'EUR' }],
              link: { self: '/accounts?page=1', next: '/accounts?page=2' },
            }),
          ),
        )
        .mockReturnValueOnce(
          of(
            fakeResponse({
              account: [{ acc_number: '002', amount: '200', currency: 'EUR' }],
              link: { self: '/accounts?page=2', next: null },
            }),
          ),
        );

      const accounts = await createAdapter(httpService).getAccounts('token-1');

      expect(accounts).toEqual([
        { accNumber: '001', amount: 100, currency: 'EUR' },
        { accNumber: '002', amount: 200, currency: 'EUR' },
      ]);
      expect(httpService.get).toHaveBeenCalledTimes(2);
      expect(httpService.get).toHaveBeenNthCalledWith(
        2,
        'http://localhost:3000/accounts?page=2',
        { headers: { Authorization: 'Bearer token-1' } },
      );
    });

    it('returns an empty array when the user has no account', async () => {
      const httpService = createHttpServiceMock();
      httpService.get.mockReturnValueOnce(
        of(
          fakeResponse({
            account: [],
            link: { self: '/accounts?page=1', next: null },
          }),
        ),
      );

      const accounts = await createAdapter(httpService).getAccounts('token-1');

      expect(accounts).toEqual([]);
    });

    it('converts a network failure into a BankUnavailableException', async () => {
      const httpService = createHttpServiceMock();
      httpService.get.mockReturnValueOnce(throwError(() => fakeNetworkError()));

      await expect(
        createAdapter(httpService).getAccounts('token-1'),
      ).rejects.toThrow(BankUnavailableException);
    });
  });

  describe('getTransactions', () => {
    it('maps a single page of transactions, converting DBT/CDT to a signed amount', async () => {
      const httpService = createHttpServiceMock();
      httpService.get.mockReturnValueOnce(
        of(
          fakeResponse({
            transactions: [
              {
                id: 1,
                label: 'Coffee',
                sign: 'DBT',
                amount: '3',
                currency: 'EUR',
              },
              {
                id: 2,
                label: 'Salary',
                sign: 'CDT',
                amount: '2000',
                currency: 'EUR',
              },
            ],
            link: { self: '/accounts/001/transactions?page=1', next: null },
          }),
        ),
      );

      const transactions = await createAdapter(httpService).getTransactions(
        'token-1',
        '001',
      );

      expect(transactions).toEqual([
        { id: '1', label: 'Coffee', amount: -3, currency: 'EUR' },
        { id: '2', label: 'Salary', amount: 2000, currency: 'EUR' },
      ]);
      expect(httpService.get).toHaveBeenCalledWith(
        'http://localhost:3000/accounts/001/transactions',
        { headers: { Authorization: 'Bearer token-1' } },
      );
    });

    it('follows pagination links until next is null', async () => {
      const httpService = createHttpServiceMock();
      httpService.get
        .mockReturnValueOnce(
          of(
            fakeResponse({
              transactions: [
                {
                  id: 1,
                  label: 'a',
                  sign: 'DBT',
                  amount: '1',
                  currency: 'EUR',
                },
              ],
              link: {
                self: '/accounts/001/transactions?page=1',
                next: '/accounts/001/transactions?page=2',
              },
            }),
          ),
        )
        .mockReturnValueOnce(
          of(
            fakeResponse({
              transactions: [
                {
                  id: 2,
                  label: 'b',
                  sign: 'CDT',
                  amount: '2',
                  currency: 'EUR',
                },
              ],
              link: { self: '/accounts/001/transactions?page=2', next: null },
            }),
          ),
        );

      const transactions = await createAdapter(httpService).getTransactions(
        'token-1',
        '001',
      );

      expect(transactions).toEqual([
        { id: '1', label: 'a', amount: -1, currency: 'EUR' },
        { id: '2', label: 'b', amount: 2, currency: 'EUR' },
      ]);
      expect(httpService.get).toHaveBeenCalledTimes(2);
    });

    it('deduplicates transactions repeated across pages by id', async () => {
      const httpService = createHttpServiceMock();
      const duplicate = {
        id: 1,
        label: 'a',
        sign: 'DBT' as const,
        amount: '1',
        currency: 'EUR',
      };
      httpService.get
        .mockReturnValueOnce(
          of(
            fakeResponse({
              transactions: [duplicate],
              link: {
                self: '/accounts/001/transactions?page=1',
                next: '/accounts/001/transactions?page=2',
              },
            }),
          ),
        )
        .mockReturnValueOnce(
          of(
            fakeResponse({
              transactions: [duplicate],
              link: { self: '/accounts/001/transactions?page=2', next: null },
            }),
          ),
        );

      const transactions = await createAdapter(httpService).getTransactions(
        'token-1',
        '001',
      );

      expect(transactions).toEqual([
        { id: '1', label: 'a', amount: -1, currency: 'EUR' },
      ]);
    });

    it('returns an empty array when the account has no transaction', async () => {
      const httpService = createHttpServiceMock();
      httpService.get.mockReturnValueOnce(
        of(
          fakeResponse({
            transactions: [],
            link: { self: '/accounts/001/transactions?page=1', next: null },
          }),
        ),
      );

      const transactions = await createAdapter(httpService).getTransactions(
        'token-1',
        '001',
      );

      expect(transactions).toEqual([]);
    });

    it('converts an expired-token 401 into a BankAuthenticationException', async () => {
      const httpService = createHttpServiceMock();
      httpService.get.mockReturnValueOnce(
        throwError(() => fakeAxiosError(401, 'Unauthorized')),
      );

      await expect(
        createAdapter(httpService).getTransactions('token-1', '001'),
      ).rejects.toThrow(BankAuthenticationException);
    });
  });
});
