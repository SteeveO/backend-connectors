import { ApiProperty } from '@nestjs/swagger';
import { TransactionDto } from './transaction.dto';

export class AggregatedAccountDto {
  @ApiProperty({ description: 'Account number', example: '000000001' })
  accNumber: string;

  @ApiProperty({ description: 'Account balance', example: 3000 })
  amount: number;

  @ApiProperty({
    description: 'All transactions for this account, deduplicated by id',
    type: [TransactionDto],
  })
  transactions: TransactionDto[];
}
