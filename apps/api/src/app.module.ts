import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AccountsModule } from './accounts/accounts.module';
import { ApiKeyGuard } from './common/api-key.guard';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { TransactionsModule } from './transactions/transactions.module';

@Module({
  imports: [DbModule, ScheduleModule.forRoot(), AccountsModule, TransactionsModule, ReconciliationModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
