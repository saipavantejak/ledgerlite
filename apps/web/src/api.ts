import type {
  AccountDto,
  CreateTransactionRequest,
  ReconciliationRunDto,
  TransactionDto,
  TransactionPage,
} from '@ledgerlite/shared';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const KEY = import.meta.env.VITE_API_KEY as string | undefined; // dev-grade shared secret, visible in the bundle

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(KEY ? { 'x-api-key': KEY } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string | string[] };
  if (!res.ok) {
    const m = data.message;
    throw new ApiError(res.status, Array.isArray(m) ? m.join('; ') : (m ?? res.statusText));
  }
  return { status: res.status, data };
}

export const api = {
  accounts: () => call<AccountDto[]>('GET', '/accounts').then((r) => r.data),
  createAccount: (b: { code: string; name: string; type: string }) => call<AccountDto>('POST', '/accounts', b).then((r) => r.data),
  transactions: (cursor?: string) =>
    call<TransactionPage>('GET', `/transactions?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).then((r) => r.data),
  postTransaction: (b: CreateTransactionRequest) => call<TransactionDto>('POST', '/transactions', b),
  reverse: (id: string, b: { idempotencyKey: string; reason: string }) => call<TransactionDto>('POST', `/transactions/${id}/reverse`, b),
  runs: () => call<ReconciliationRunDto[]>('GET', '/reconciliation/runs').then((r) => r.data),
  run: (id: string) => call<ReconciliationRunDto>('GET', `/reconciliation/runs/${id}`).then((r) => r.data),
  runReconciliation: () => call<ReconciliationRunDto>('POST', '/reconciliation/run').then((r) => r.data),
};
