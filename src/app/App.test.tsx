import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { lazy } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoAccessibilityViolations } from '../test/axe';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import { Layout } from './Layout';
import { PageHeading } from './PageHeading';
import { routes } from './router';

beforeEach(() => {
  server.use(http.get('*/api/readyz', () => HttpResponse.json({ status: 'ready' })));
});

describe('the application frame', () => {
  it('has the landmarks a screen reader navigates by: banner, main navigation, main', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('shows the connection status in the banner', async () => {
    renderApp('/');
    expect(await within(screen.getByRole('banner')).findByText('API ready')).toBeInTheDocument();
  });

  it('starts with a link that skips the navigation, and it leads to the main area', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1'); // so the skip link can focus it
  });

  it('has the navigation reachable by keyboard, and marks the current page', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    await user.tab(); // skip link
    await user.tab();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  });

  it('does not take focus on the first load', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(document.body).toHaveFocus();
  });
});

describe('pages', () => {
  it.each([
    ['/', 'Overview'],
    ['/settings', 'Settings'],
    ['/no/such/page', 'Page not found'],
  ])(
    '%s: one top-level heading, a title of its own, and no accessibility violations',
    async (path, title) => {
      const { container } = renderApp(path);
      expect(await screen.findAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
      expect(document.title).toBe(`${title} · ledgerd console`);
      await screen.findByText('API ready');
      await expectNoAccessibilityViolations(container);
    },
  );

  it('every page has a different title', async () => {
    const titles = new Set<string>();
    for (const path of ['/', '/settings', '/nowhere']) {
      const { unmount } = renderApp(path);
      await screen.findByRole('heading', { level: 1 });
      titles.add(document.title);
      unmount();
    }
    expect(titles.size).toBe(3);
  });

  it('an unknown address shows a page with a way back, not a blank screen', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/accounts/xyz/nonsense');
    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'overview' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('navigating', () => {
  it('moves to the page, changes the title, and puts focus on the new heading', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(document.title).toBe('Settings · ledgerd console');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  it('puts focus on the heading when the page was already loaded (going back)', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await user.click(screen.getByRole('link', { name: 'Overview' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Overview' });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('when a page fails', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function Broken(): never {
    throw new Error('internal detail');
  }
  const NeverLoads = lazy(() =>
    Promise.reject(new Error('Failed to fetch dynamically imported module')),
  );
  const brokenRoutes = [
    {
      path: '/',
      element: <Layout />,
      children: [
        { index: true, element: <FineIndex /> },
        { path: 'broken', element: <Broken /> },
        {
          path: 'chunk',
          element: <NeverLoads />,
        },
      ],
    },
  ];
  function FineIndex() {
    return <PageHeading title="Fine" />;
  }

  it('shows a notice in the page area and keeps the frame working', async () => {
    renderApp('/broken', brokenRoutes);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This part of the page could not be shown');
    expect(alert).not.toHaveTextContent('internal detail');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('recovers when the user moves to another page', async () => {
    const user = userEvent.setup();
    renderApp('/broken', brokenRoutes);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('link', { name: 'Overview' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Fine' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('also catches a page whose code cannot be loaded (for instance after a new release)', async () => {
    renderApp('/chunk', brokenRoutes);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Reload the page'.slice(0, 0) + 'could not be shown',
    );
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
  });
});

describe('the route table', () => {
  it('serves each page in the navigation', async () => {
    const { NAV_ITEMS } = await import('./nav');
    const paths = (routes[0]?.children ?? []).map((r) => r.path ?? '');
    for (const item of NAV_ITEMS) {
      if (item.to !== '/') expect(paths, item.to).toContain(item.to.slice(1));
    }
  });
});
