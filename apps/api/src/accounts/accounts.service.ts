import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AccountDto, AccountType, Direction } from '@ledgerlite/shared';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { asObject, invalid, str, uuid } from '../common/validate';
import { isUniqueViolation, iso } from '../common/sql';

const TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const NORMAL: Record<AccountType, Direction> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
};

interface Row {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normal_balance: Direction;
  currency: string;
  created_at: string;
  signed: string;
}

const SELECT = `SELECT a.id, a.code, a.name, a.type, a.normal_balance, a.currency, ${iso('a.created_at')} AS created_at,
  b.balance_cents::text AS signed
  FROM accounts a JOIN account_balances b ON b.account_id = a.id`;

function toDto(r: Row): AccountDto {
  const signed = BigInt(r.signed);
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    normalBalance: r.normal_balance,
    currency: r.currency,
    createdAt: r.created_at,
    signedBalanceCents: signed.toString(),
    balanceCents: (r.normal_balance === 'debit' ? signed : -signed).toString(),
  };
}

@Injectable()
export class AccountsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async create(body: unknown): Promise<AccountDto> {
    const b = asObject(body);
    const code = str(b.code, 'code', 50);
    const name = str(b.name, 'name', 200);
    const type = b.type as AccountType;
    if (!TYPES.includes(type)) invalid(`type must be one of ${TYPES.join(', ')}`);
    try {
      const r = await this.pool.query<{ id: string }>(
        `INSERT INTO accounts (code, name, type, normal_balance) VALUES ($1, $2, $3, $4) RETURNING id`,
        [code, name, type, NORMAL[type]],
      );
      return this.get(r.rows[0]!.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`account code ${code} already exists`);
      throw err;
    }
  }

  async list(): Promise<AccountDto[]> {
    const r = await this.pool.query<Row>(`${SELECT} ORDER BY a.code`);
    return r.rows.map(toDto);
  }

  async get(id: string): Promise<AccountDto> {
    const r = await this.pool.query<Row>(`${SELECT} WHERE a.id = $1`, [uuid(id, 'id')]);
    if (!r.rows[0]) throw new NotFoundException('account not found');
    return toDto(r.rows[0]);
  }
}
