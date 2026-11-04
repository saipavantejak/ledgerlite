import type { AccountDto, AccountType, CreateTransactionRequest } from '@ledgerlite/shared';

const ACCOUNTS: { code: string; name: string; type: AccountType }[] = [
  { code: '1000', name: 'Cash', type: 'asset' },
  { code: '2000', name: 'Member Wallet', type: 'liability' },
  { code: '2100', name: 'Provider Payable', type: 'liability' },
  { code: '2200', name: 'Card Clearing', type: 'liability' },
  { code: '2300', name: 'Employer Funding', type: 'liability' },
  { code: '4000', name: 'Fee Revenue', type: 'revenue' },
];

type Flow = { name: string; description: string; debit: string; credit: string; cents: string };
const FLOWS: Flow[] = [
  { name: 'employer-funding', description: 'Employer funding $500.00', debit: '1000', credit: '2000', cents: '50000' },
  { name: 'member-payment', description: 'Member payment to provider $120.00', debit: '2000', credit: '2100', cents: '12000' },
  { name: 'provider-payout', description: 'Provider payout $120.00', debit: '2100', credit: '1000', cents: '12000' },
  { name: 'card-spend', description: 'Prepaid card spend $45.50', debit: '2000', credit: '2200', cents: '4550' },
  { name: 'card-settlement', description: 'Card settlement $45.50', debit: '2200', credit: '1000', cents: '4550' },
];

/** Seeds accounts and posts the five demo flows through the real HTTP API. Safe to run repeatedly (fixed idempotency keys). */
export async function seedDemo(baseUrl: string, apiKey?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) };
  const call = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> => {
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await res.json()) as T;
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
    return { status: res.status, data };
  };

  let accounts = (await call<AccountDto[]>('GET', '/accounts')).data;
  for (const a of ACCOUNTS) {
    if (!accounts.some((x) => x.code === a.code)) await call('POST', '/accounts', a);
  }
  accounts = (await call<AccountDto[]>('GET', '/accounts')).data;
  const id = (code: string): string => accounts.find((a) => a.code === code)!.id;

  for (const [i, f] of FLOWS.entries()) {
    const body: CreateTransactionRequest = {
      idempotencyKey: `demo-flow-${i + 1}-${f.name}`,
      description: f.description,
      reference: `demo:${f.name}`,
      entries: [
        { accountId: id(f.debit), direction: 'debit', amountCents: f.cents },
        { accountId: id(f.credit), direction: 'credit', amountCents: f.cents },
      ],
    };
    await call('POST', '/transactions', body);
  }

  const final = (await call<AccountDto[]>('GET', '/accounts')).data;
  return Object.fromEntries(final.map((a) => [a.name, a.balanceCents]));
}
