import type { ReactNode } from 'react';

export const card = 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm';
export const btn = 'rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40';
export const btnGhost = 'rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40';
export const input = 'rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none';

export function Title({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-semibold">{children}</h2>
      {right}
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null;
}

export const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
