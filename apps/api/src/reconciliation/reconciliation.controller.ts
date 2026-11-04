import { Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';

@Controller('reconciliation')
export class ReconciliationController {
  constructor(@Inject(ReconciliationService) private readonly svc: ReconciliationService) {}

  @Post('run')
  run() {
    return this.svc.run();
  }

  @Get('runs')
  runs() {
    return this.svc.listRuns();
  }

  @Get('runs/:id')
  one(@Param('id') id: string) {
    return this.svc.getRun(id);
  }
}
