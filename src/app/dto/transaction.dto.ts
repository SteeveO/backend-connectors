import { ApiProperty } from '@nestjs/swagger';

export class TransactionDto {
  @ApiProperty({ description: 'Transaction identifier', example: '1' })
  id: string;

  @ApiProperty({ description: 'Transaction label', example: 'label 1' })
  label: string;

  @ApiProperty({
    description:
      'Signed transaction amount (negative for a debit, positive for a credit)',
    example: -30,
  })
  amount: number;

  @ApiProperty({ description: 'Transaction currency', example: 'EUR' })
  currency: string;
}
