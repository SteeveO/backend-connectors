export class BankUnavailableException extends Error {
  constructor(message = 'Bank service is unavailable') {
    super(message);
    this.name = 'BankUnavailableException';
  }
}
