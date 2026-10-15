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
  { to: '/settings', label: 'Settings' },
];
