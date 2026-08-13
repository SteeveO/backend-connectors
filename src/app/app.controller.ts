import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AggregateAccountsUseCase } from '../domain/use-cases/aggregate-accounts.use-case';
import { AggregatedAccountDto } from './dto/aggregated-account.dto';
import { ErrorResponseDto } from './dto/error-response.dto';

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
  @ApiResponse({
    status: 401,
    description: 'Bank authentication failed (invalid credentials)',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'The Bridge mock server is unreachable',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Unexpected error',
    type: ErrorResponseDto,
  })
  async getAggregatedAccounts(): Promise<AggregatedAccountDto[]> {
    const aggregatedAccounts = await this.aggregateAccountsUseCase.execute();

    return aggregatedAccounts.map((account) => ({
      accNumber: account.accNumber,
      amount: account.amount,
      transactions: account.transactions,
    }));
  }
}
