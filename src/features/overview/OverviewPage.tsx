import { PageHeading } from '../../app/PageHeading';
import { ConnectionPanel } from '../status/ConnectionPanel';

export default function OverviewPage() {
  return (
    <>
      <PageHeading title="Overview" />
      <p className="mb-6 max-w-prose text-slate-700 dark:text-slate-300">
        A window onto a double-entry ledger: accounts, transfers, history, and reconciliation.
      </p>
      <ConnectionPanel />
    </>
  );
}
