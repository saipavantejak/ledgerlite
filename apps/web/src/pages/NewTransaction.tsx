import type { AccountDto, Direction, TransactionDto } from '@ledgerlite/shared';
import { formatCents, parseDollarsToCents } from '@ledgerlite/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { btn, btnGhost, card, ErrorBox, input, message, Title } from '../ui';

interface Row {
  accountId: string;
  direction: Direction;
  amount: string; // dollars as typed; converted to integer cents, never to a float
}
const blank = (direction: Direction): Row => ({ accountId: '', direction, amount: '' });
const newKey = () => crypto.randomUUID();

export function NewTransaction() {
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<Row[]>([blank('debit'), blank('credit')]);
  const [key, setKey] = useState(newKey);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: number; tx: TransactionDto } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.accounts().then(setAccounts).catch((e) => setError(message(e)));
  }, []);

  const { debits, credits, valid } = useMemo(() => {
    let d = 0n;
    let c = 0n;
    let allValid = true;
    for (const r of rows) {
      const cents = parseDollarsToCents(r.amount);
      if (cents === null || cents === 0n || !r.accountId) allValid = false;
      if (cents) (r.direction === 'debit' ? (d += cents) : (c += cents));
    }
    return { debits: d, credits: c, valid: allValid && rows.length >= 2 && d === c && d > 0n };
  }, [rows]);

  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.postTransaction({
        idempotencyKey: key,
        description: description.trim(),
        entries: rows.map((r) => ({ accountId: r.accountId, direction: r.direction, amountCents: parseDollarsToCents(r.amount)!.toString() })),
      });
      setResult({ status: res.status, tx: res.data });
      setRows([blank('debit'), blank('credit')]);
      setDescription('');
      setKey(newKey()); // a fresh key for the next, different transaction
    } catch (e) {
      setError(message(e)); // keep the key: retrying the same form is then safe
    } finally {
      setBusy(false);
    }
  };

  const balanced = debits === credits && debits > 0n;
  return (
    <div>
      <Title>New transaction</Title>
      <ErrorBox error={error} />
      {result && (
        <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          {result.status === 201 ? 'Posted' : 'Already posted (idempotent replay)'}: <span className="font-mono">{result.tx.id}</span>
        </div>
      )}
      <div className={card}>
        <label className="text-xs">Description<br />
          <input className={`${input} w-full`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="mt-4 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className={input} value={r.direction} onChange={(e) => update(i, { direction: e.target.value as Direction })}>
                <option value="debit">Debit</option><option value="credit">Credit</option>
              </select>
              <select className={`${input} min-w-56 flex-1`} value={r.accountId} onChange={(e) => update(i, { accountId: e.target.value })}>
                <option value="">Select account…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
              <input className={`${input} w-32 text-right font-mono`} placeholder="0.00" inputMode="decimal" value={r.amount} onChange={(e) => update(i, { amount: e.target.value })} />
              <button className={btnGhost} disabled={rows.length <= 2} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
        </div>
        <button className={`${btnGhost} mt-3`} onClick={() => setRows([...rows, blank('debit')])}>+ Add row</button>
        <div className={`mt-4 rounded-md px-3 py-2 text-sm ${balanced ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>
          Debits <b className="font-mono">{formatCents(debits)}</b> {balanced ? '=' : '≠'} Credits <b className="font-mono">{formatCents(credits)}</b>
          {balanced ? ' — balanced' : ` — out of balance by ${formatCents(debits > credits ? debits - credits : credits - debits)}`}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          Idempotency key <code className="rounded bg-slate-100 px-1.5 py-0.5">{key}</code>
          <button className={btnGhost} onClick={() => setKey(newKey())}>Regenerate</button>
        </div>
        <button className={`${btn} mt-4`} disabled={!valid || !description.trim() || busy} onClick={() => void submit()}>
          {busy ? 'Posting…' : 'Post transaction'}
        </button>
      </div>
    </div>
  );
}
