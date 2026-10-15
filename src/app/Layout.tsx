import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';

import { ReadinessBadge } from '../features/status/ReadinessBadge';
import { Loading } from '../ui/Status';
import { ErrorBoundary } from './ErrorBoundary';
import { NAV_ITEMS } from './nav';
import { NavigatedContext } from './PageHeading';

/**
 * The frame around every page: a way to skip the navigation, the banner with the connection
 * status, the main navigation, and the page itself. A page that fails to load or to draw
 * shows a notice in the main area; the banner and the navigation stay usable.
 */
export function Layout() {
  const location = useLocation();
  const [firstKey] = useState(location.key);
  const navigated = location.key !== firstKey;

  return (
    <NavigatedContext.Provider value={navigated}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900 dark:focus:bg-slate-900 dark:focus:text-slate-100"
      >
        Skip to main content
      </a>
      <header className="border-b border-slate-300 dark:border-slate-700">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-lg font-semibold">ledgerd console</p>
          <ReadinessBadge />
        </div>
        <nav aria-label="Main" className="mx-auto max-w-6xl px-4 pb-2">
          <ul className="flex flex-wrap gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end ?? false}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${isActive ? 'font-semibold underline decoration-2 underline-offset-4' : ''}`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 outline-none">
        <ErrorBoundary resetKey={location.key}>
          <Suspense fallback={<Loading what="the page" />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </NavigatedContext.Provider>
  );
}
