import type { AccountDto, TransactionDto } from '@ledgerlite/shared';
import { formatCents } from '@ledgerlite/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { btnGhost, card, ErrorBox, message, Title } from '../ui';

export function Ledger() {
  const [txs, setTxs] = useState<TransactionDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Map<string, AccountDto>>(new Map());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const keys = useRef<Record<string, string>>({}); // one idempotency key per reversal attempt, reused on retry

  const load = useCallback(async () => {
    try {
      const [page, accs] = await Promise.all([api.transactions(), api.accounts()]);
      setTxs(page.items);
      setCursor(page.nextCursor);
      setAccounts(new Map(accs.map((a) => [a.id, a])));
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const more = async () => {
    if (!cursor) return;
    try {
      const page = await api.transactions(cursor);
      setTxs((t) => [...t, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(message(e));
    }
  };

  const reverse = async (tx: TransactionDto) => {
    const reason = window.prompt('Reason for reversal?');
    if (!reason?.trim()) return;
    setError(null);
    const key = (keys.current[tx.id] ??= crypto.randomUUID());
    try {
      await api.reverse(tx.id, { idempotencyKey: key, reason: reason.trim() });
      delete keys.current[tx.id];
      await load();
    } catch (e) {
      setError(message(e));
    }
  };

  const reversed = new Set(txs.flatMap((t) => (t.reference?.startsWith('reverses:') ? [t.reference.slice('reverses:'.length)] : [])));
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });

  return (
    <div>
      <Title right={<button className={btnGhost} onClick={() => void load()}>Refresh</button>}>Ledger</Title>
      <ErrorBox error={error} />
      <div className="space-y-2">
        {txs.map((t) => {
          const isReversal = t.reference?.startsWith('reverses:');
          return (
            <div key={t.id} className={card}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button className="text-left" onClick={() => toggle(t.id)}>
                  <span className="mr-2 text-slate-400">{open.has(t.id) ? '▾' : '▸'}</span>
                  <span className="font-medium">{t.description}</span>
                  {isReversal && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">reversal</span>}
                  {reversed.has(t.id) && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs">reversed</span>}
                </button>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{new Date(t.createdAt).toLocaleString()}</span>
                  <button className={btnGhost} disabled={reversed.has(t.id)} onClick={() => void reverse(t)}>Reverse</button>
                </div>
              </div>
              {open.has(t.id) && (
                <table className="mt-3 w-full text-sm">
                  <tbody>
                    {t.entries.map((e) => (
                      <tr key={e.id} className="border-t">
                        <td className="py-1.5">{accounts.get(e.accountId)?.code} · {accounts.get(e.accountId)?.name ?? e.accountId}</td>
                        <td className="text-right font-mono">{e.direction === 'debit' ? formatCents(e.amountCents) : ''}</td>
                        <td className="text-right font-mono">{e.direction === 'credit' ? formatCents(e.amountCents) : ''}</td>
                      </tr>
                    ))}
                    <tr className="border-t text-xs text-slate-500"><td className="pt-1.5">debit / credit</td><td /><td /></tr>
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
        {txs.length === 0 && <div className={`${card} text-center text-sm text-slate-500`}>No transactions yet.</div>}
      </div>
      {cursor && <button className={`${btnGhost} mt-3`} onClick={() => void more()}>Load more</button>}
    </div>
  );
}
