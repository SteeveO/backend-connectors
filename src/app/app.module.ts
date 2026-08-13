import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AggregateAccountsUseCase } from '../domain/use-cases/aggregate-accounts.use-case';
import { BANK_PORT, BankPort } from '../domain/ports/bank.port';
import { BridgeBankAdapter } from '../infrastructure/adapters/bridge-bank.adapter';
import { AppController } from './app.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HttpModule],
  controllers: [AppController],
  providers: [
    { provide: BANK_PORT, useClass: BridgeBankAdapter },
    {
      provide: AggregateAccountsUseCase,
      useFactory: (bankPort: BankPort) =>
        new AggregateAccountsUseCase(bankPort),
      inject: [BANK_PORT],
    },
  ],
})
export class AppModule {}
