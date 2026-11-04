import { useState } from 'react';
import { Accounts } from './pages/Accounts';
import { Ledger } from './pages/Ledger';
import { NewTransaction } from './pages/NewTransaction';
import { Reconciliation } from './pages/Reconciliation';

const PAGES = {
  Accounts: Accounts,
  'New Transaction': NewTransaction,
  Ledger: Ledger,
  Reconciliation: Reconciliation,
} as const;
type PageName = keyof typeof PAGES;

export function App() {
  const [page, setPage] = useState<PageName>('Accounts');
  const Page = PAGES[page];
  return (
    <div className="mx-auto max-w-5xl p-4">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">LedgerLite</h1>
        <nav className="flex gap-1">
          {(Object.keys(PAGES) as PageName[]).map((name) => (
            <button
              key={name}
              onClick={() => setPage(name)}
              className={`rounded-md px-3 py-1.5 text-sm ${page === name ? 'bg-slate-900 text-white' : 'hover:bg-slate-200'}`}
            >
              {name}
            </button>
          ))}
        </nav>
      </header>
      <Page />
    </div>
  );
}
