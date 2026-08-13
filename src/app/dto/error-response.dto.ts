import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ description: 'HTTP status code', example: 500 })
  statusCode: number;

  @ApiProperty({
    description: 'Human-readable error message',
    example: 'Internal server error',
  })
  message: string;

  @ApiProperty({
    description: 'ISO 8601 timestamp of the error',
    example: '2026-08-13T15:00:00.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Request path that triggered the error',
    example: '/aggregated-accounts',
  })
  path: string;
}
