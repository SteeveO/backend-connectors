export class BankAuthenticationException extends Error {
  constructor(message = 'Bank authentication failed') {
    super(message);
    this.name = 'BankAuthenticationException';
  }
}
