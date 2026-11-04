export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type Direction = 'debit' | 'credit';

/** All money amounts cross the API as decimal strings of integer cents. */
export interface AccountDto {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: Direction;
  currency: string;
  createdAt: string;
  /** Balance on the account's normal side (positive = normal). */
  balanceCents: string;
  /** Debits minus credits. */
  signedBalanceCents: string;
}

export interface EntryDto {
  id: string;
  accountId: string;
  direction: Direction;
  amountCents: string;
  memo: string | null;
}

export interface TransactionDto {
  id: string;
  idempotencyKey: string;
  description: string;
  reference: string | null;
  createdAt: string;
  entries: EntryDto[];
}

export interface TransactionPage {
  items: TransactionDto[];
  nextCursor: string | null;
}

export interface CreateTransactionRequest {
  idempotencyKey: string;
  description: string;
  reference?: string;
  entries: { accountId: string; direction: Direction; amountCents: string }[];
}

export interface ReconciliationCheck {
  ok: boolean;
  detail: string;
}

export interface ReconciliationFinding {
  id: string;
  checkName: string;
  detail: string;
  foundAt: string;
}

export interface ReconciliationRunDto {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'drift';
  checks: Record<string, ReconciliationCheck>;
  findings?: ReconciliationFinding[];
}

/** Integer cents -> "$1,234.50" (negative: "-$1,234.50"). Never goes through float. */
export function formatCents(cents: string | bigint): string {
  const v = typeof cents === 'bigint' ? cents : BigInt(cents);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const dollars = (abs / 100n).toLocaleString('en-US');
  const rem = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}$${dollars}.${rem}`;
}

/** "12.5" / "12.50" / "12" -> 1250n. Returns null for anything else (no floats, no more than 2 decimals). */
export function parseDollarsToCents(input: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const dollars = BigInt(m[1]!);
  const cents = BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  return dollars * 100n + cents;
}
