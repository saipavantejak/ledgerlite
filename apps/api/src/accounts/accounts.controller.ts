import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  @Post()
  create(@Body() body: unknown) {
    return this.accounts.create(body);
  }

  @Get()
  list() {
    return this.accounts.list();
  }

  @Get(':id/balance')
  async balance(@Param('id') id: string) {
    const a = await this.accounts.get(id);
    return {
      accountId: a.id,
      code: a.code,
      balanceCents: a.balanceCents,
      signedBalanceCents: a.signedBalanceCents,
    };
  }
}
