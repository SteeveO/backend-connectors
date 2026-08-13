export interface BridgeLoginResponse {
  refresh_token: string;
}

export interface BridgeTokenResponse {
  access_token: string;
}

export interface BridgeLink {
  self: string;
  next: string | null;
}

export interface BridgeAccount {
  acc_number: string;
  amount: string;
  currency: string;
}

export interface BridgeAccountsResponse {
  account: BridgeAccount[];
  link: BridgeLink;
}

export type BridgeTransactionSign = 'DBT' | 'CDT';

export interface BridgeTransaction {
  id: number;
  label: string;
  sign: BridgeTransactionSign;
  amount: string;
  currency: string;
}

export interface BridgeTransactionsResponse {
  transactions: BridgeTransaction[];
  link: BridgeLink;
}
