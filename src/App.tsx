import { ReadinessBadge } from './features/status/ReadinessBadge';

export function App() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">ledgerd console</h1>
        <ReadinessBadge />
      </header>
      <p className="mt-4 text-sm opacity-80">
        A window onto a double-entry ledger: accounts, transfers, history, and reconciliation.
      </p>
    </main>
  );
}
