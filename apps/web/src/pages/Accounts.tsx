import type { AccountDto } from '@ledgerlite/shared';
import { formatCents } from '@ledgerlite/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { btn, btnGhost, card, ErrorBox, input, message, Title } from '../ui';

export function Accounts() {
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', type: 'asset' });

  const load = useCallback(() => api.accounts().then(setAccounts).catch((e) => setError(message(e))), []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setError(null);
    try {
      await api.createAccount(form);
      setForm({ code: '', name: '', type: form.type });
      await load();
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <div>
      <Title right={<button className={btnGhost} onClick={() => void load()}>Refresh</button>}>Accounts</Title>
      <ErrorBox error={error} />
      <div className={`${card} mb-4 flex flex-wrap items-end gap-2`}>
        <label className="text-xs">Code<br /><input className={`${input} w-24`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
        <label className="text-xs">Name<br /><input className={`${input} w-56`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="text-xs">Type<br />
          <select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {['asset', 'liability', 'equity', 'revenue', 'expense'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <button className={btn} disabled={!form.code.trim() || !form.name.trim()} onClick={() => void create()}>Add account</button>
      </div>
      <div className={`${card} overflow-x-auto p-0`}>
        <table className="w-full text-sm">
          <thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr><th className="p-3">Code</th><th>Name</th><th>Type</th><th>Normal</th><th className="pr-3 text-right">Balance</th></tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="p-3 font-mono">{a.code}</td><td>{a.name}</td><td>{a.type}</td><td>{a.normalBalance}</td>
                <td className="pr-3 text-right font-mono">{formatCents(a.balanceCents)}</td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-500">No accounts yet. Add one above, or run <code>pnpm seed</code>.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
