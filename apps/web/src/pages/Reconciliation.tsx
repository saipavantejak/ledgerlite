import type { ReconciliationRunDto } from '@ledgerlite/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { btn, card, ErrorBox, message, Title } from '../ui';

const badge = (s: string) =>
  s === 'ok' ? 'bg-green-100 text-green-900' : s === 'drift' ? 'bg-red-100 text-red-900' : 'bg-slate-200 text-slate-800';

export function Reconciliation() {
  const [runs, setRuns] = useState<ReconciliationRunDto[]>([]);
  const [latest, setLatest] = useState<ReconciliationRunDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.runs();
      setRuns(list);
      setLatest(list[0] ? await api.run(list[0].id) : null);
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.runReconciliation();
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Title right={<button className={btn} disabled={busy} onClick={() => void run()}>{busy ? 'Running…' : 'Run now'}</button>}>Reconciliation</Title>
      <ErrorBox error={error} />
      {latest ? (
        <div className={card}>
          <div className="flex items-center gap-3">
            <span className={`rounded px-2 py-0.5 text-sm font-semibold ${badge(latest.status)}`}>{latest.status.toUpperCase()}</span>
            <span className="text-xs text-slate-500">started {new Date(latest.startedAt).toLocaleString()}</span>
          </div>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {Object.entries(latest.checks).map(([name, c]) => (
                <tr key={name} className="border-t">
                  <td className="py-1.5 font-mono">{name}</td>
                  <td className={c.ok ? 'text-green-700' : 'text-red-700'}>{c.ok ? 'pass' : 'FAIL'}</td>
                  <td className="text-slate-600">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {latest.findings && latest.findings.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold">Findings</h3>
              <ul className="space-y-1 text-sm">
                {latest.findings.map((f) => (
                  <li key={f.id} className="rounded bg-red-50 px-2 py-1"><span className="font-mono text-xs">{f.checkName}</span> — {f.detail}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className={`${card} text-center text-sm text-slate-500`}>No runs yet. Click “Run now”.</div>
      )}
      {runs.length > 1 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold">Previous runs</h3>
          <ul className="space-y-1 text-sm">
            {runs.slice(1).map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${badge(r.status)}`}>{r.status}</span>
                <span className="text-slate-600">{new Date(r.startedAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
