import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AggregateAccountsUseCase } from '../domain/use-cases/aggregate-accounts.use-case';
import { AggregatedAccountDto } from './dto/aggregated-account.dto';

@ApiTags('aggregated-accounts')
@Controller()
export class AppController {
  constructor(
    private readonly aggregateAccountsUseCase: AggregateAccountsUseCase,
  ) {}

  @Get('aggregated-accounts')
  @ApiOperation({
    summary: "Aggregate all of the user's bank accounts and their transactions",
  })
  @ApiResponse({
    status: 200,
    description:
      'The aggregated accounts, each with its deduplicated transactions',
    type: [AggregatedAccountDto],
  })
  @ApiResponse({ status: 500, description: 'Unexpected error' })
  async getAggregatedAccounts(): Promise<AggregatedAccountDto[]> {
    const aggregatedAccounts = await this.aggregateAccountsUseCase.execute();

    return aggregatedAccounts.map((account) => ({
      accNumber: account.accNumber,
      amount: account.amount,
      transactions: account.transactions,
    }));
  }
}
