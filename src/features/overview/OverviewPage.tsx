import { PageHeading } from '../../app/PageHeading';

export default function OverviewPage() {
  return (
    <>
      <PageHeading title="Overview" />
      <p className="max-w-prose text-slate-700 dark:text-slate-300">
        A window onto a double-entry ledger: accounts, transfers, history, and reconciliation.
      </p>
    </>
  );
}
