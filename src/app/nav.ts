export interface NavItem {
  to: string;
  label: string;
  /** Match only this exact path (the overview), not everything below it. */
  end?: boolean;
}

/** The main navigation. A page is added here when it exists. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Overview', end: true },
  { to: '/accounts', label: 'Accounts' },
  { to: '/transactions', label: 'Transactions', end: true },
  { to: '/transactions/new', label: 'New transaction' },
  { to: '/lab', label: 'Failure Lab' },
  { to: '/reconciliation', label: 'Reconciliation' },
  { to: '/benchmark', label: 'Benchmark' },
  { to: '/settings', label: 'Settings' },
];
