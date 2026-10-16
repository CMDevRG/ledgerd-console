import { lazy } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';

import { FailureNotice } from './ErrorBoundary';
import { Layout } from './Layout';

// Each page is loaded when it is first visited, so the first load stays small.
const OverviewPage = lazy(() => import('../features/overview/OverviewPage'));
const AccountsPage = lazy(() => import('../features/accounts/AccountsPage'));
const AccountDetailPage = lazy(() => import('../features/accounts/AccountDetailPage'));
const BuilderPage = lazy(() => import('../features/transactions/BuilderPage'));
const LookupPage = lazy(() => import('../features/transactions/LookupPage'));
const TransactionPage = lazy(() => import('../features/transactions/TransactionPage'));
const LabPage = lazy(() => import('../features/lab/LabPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));
const NotFoundPage = lazy(() => import('./NotFoundPage'));

function RootError() {
  // Only reached if the frame itself failed; its pages are protected by their own boundary.
  return (
    <main className="mx-auto max-w-xl p-6">
      <FailureNotice
        onReload={() => {
          window.location.reload();
        }}
      />
    </main>
  );
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    errorElement: <RootError />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'accounts', element: <AccountsPage /> },
      { path: 'accounts/:id', element: <AccountDetailPage /> },
      { path: 'transactions', element: <LookupPage /> },
      { path: 'transactions/new', element: <BuilderPage /> },
      { path: 'transactions/:id', element: <TransactionPage /> },
      { path: 'lab', element: <LabPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
