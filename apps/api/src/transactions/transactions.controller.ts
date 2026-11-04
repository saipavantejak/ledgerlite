import { Body, Controller, Get, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly tx: TransactionsService) {}

  @Post()
  async create(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const r = await this.tx.post(body);
    res.status(r.status);
    return r.body;
  }

  @Get()
  list(@Query() q: Record<string, string | undefined>) {
    return this.tx.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tx.get(id);
  }

  @Post(':id/reverse')
  async reverse(@Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const r = await this.tx.reverse(id, body);
    res.status(r.status);
    return r.body;
  }
}
