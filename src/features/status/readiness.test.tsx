import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api/problem';
import { LiveRegionProvider } from '../../ui/LiveRegion';
import { makeConsoleProblem } from '../../test/factories';
import { mockReadiness } from '../../test/readiness';
import { server } from '../../test/server';
import { ConnectionPanel } from './ConnectionPanel';
import { ReadinessBadge } from './ReadinessBadge';
import {
  classifyReadiness,
  READINESS_POLL_MS,
  READINESS_VIEWS,
  type ReadinessState,
} from './readiness';

const failed = (error: unknown) => ({ isPending: false, isError: true, error });

describe('classifyReadiness', () => {
  it.each<[string, Parameters<typeof classifyReadiness>[0], ReadinessState]>([
    ['nothing yet', { isPending: true, isError: false, error: null }, 'checking'],
    ['a good answer', { isPending: false, isError: false, error: null }, 'ready'],
    ['a 503', failed(new ApiError('busy', 'x', { status: 503 })), 'not_ready'],
    ['a problem document', failed(new ApiError('refused', 'x', { status: 500 })), 'not_ready'],
    ['no answer', failed(new ApiError('network', 'x')), 'unreachable'],
    [
      'a rejected key',
      failed(
        new ApiError('network', 'x', {
          status: 502,
          problem: makeConsoleProblem('console_misconfigured', 502),
        }),
      ),
      'misconfigured',
    ],
    ['a body not understood', failed(new ApiError('unexpected', 'x')), 'unexpected'],
    ['a bug', failed(new TypeError('boom')), 'unexpected'],
    ['something thrown that is not an error', failed('text'), 'unexpected'],
  ])('%s is %s', (_name, query, expected) => {
    expect(classifyReadiness(query)).toBe(expected);
  });

  it('prefers a failure over older good data: one failed check means not ready now', () => {
    // TanStack Query keeps the last data while isError is true.
    expect(
      classifyReadiness({ isPending: false, isError: true, error: new ApiError('network', 'x') }),
    ).toBe('unreachable');
  });

  it('has a distinct label and announcement for every state', () => {
    const views = Object.values(READINESS_VIEWS);
    expect(new Set(views.map((v) => v.label)).size).toBe(views.length);
    expect(new Set(views.map((v) => v.announcement)).size).toBe(views.length);
  });
});

function renderStatus() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LiveRegionProvider>
        <ReadinessBadge />
        <ConnectionPanel />
      </LiveRegionProvider>
    </QueryClientProvider>,
  );
}

/** What the page's live region has been told, latest first. */
const announced = (): string =>
  screen
    .getAllByRole('status')
    .map((s) => s.textContent.trim())
    .join('|');

describe('announcing readiness changes (R1.4)', () => {
  it('says nothing when the first answer is "ready"', async () => {
    mockReadiness('ready');
    renderStatus();
    await screen.findByText('API ready');
    await new Promise((r) => setTimeout(r, 30));
    expect(announced()).not.toContain('ledgerd is ready');
  });

  it('announces an outage found on the first check', async () => {
    mockReadiness('unreachable');
    renderStatus();
    await screen.findByText('Cannot reach the API');
    await waitFor(() => {
      expect(announced()).toContain('Cannot reach ledgerd');
    });
  });

  it('announces each change, without moving focus', async () => {
    const user = userEvent.setup();
    mockReadiness('ready');
    renderStatus();
    await screen.findByText('API ready');

    mockReadiness('notReady');
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    await screen.findByText('API not ready');
    await waitFor(() => {
      expect(announced()).toContain('ledgerd is not ready');
    });
    expect(screen.getByRole('button', { name: 'Check now' })).toHaveFocus(); // focus stayed where it was

    mockReadiness('ready');
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    await screen.findByText('API ready');
    await waitFor(() => {
      expect(announced()).toContain('ledgerd is ready');
    });
  });

  it('does not repeat itself while the state stays the same', async () => {
    const user = userEvent.setup();
    mockReadiness('unreachable');
    renderStatus();
    await screen.findByText('Cannot reach the API');
    const region = () => screen.getAllByRole('status')[0];
    await waitFor(() => {
      expect(announced()).toContain('Cannot reach ledgerd');
    });
    const before = region()?.textContent;
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    await screen.findByText('Cannot reach the API');
    await new Promise((r) => setTimeout(r, 50));
    expect(region()?.textContent).toBe(before);
  });
});

describe('polling (R1.2)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks again every 10 seconds and updates without a reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    let ready = true;
    server.use(
      http.get('*/api/readyz', () => {
        calls += 1;
        return ready
          ? HttpResponse.json({ status: 'ready' })
          : HttpResponse.json(
              {
                type: 'urn:ledgerd:error:not_ready',
                title: 'Service not ready',
                status: 503,
                code: 'not_ready',
              },
              { status: 503, headers: { 'Content-Type': 'application/problem+json' } },
            );
      }),
    );
    renderStatus();
    await screen.findByText('API ready');
    expect(calls).toBe(1);

    ready = false;
    await vi.advanceTimersByTimeAsync(READINESS_POLL_MS + 500);
    await screen.findByText('API not ready');
    expect(calls).toBe(2);

    await vi.advanceTimersByTimeAsync(READINESS_POLL_MS);
    expect(calls).toBe(3);
  });

  it('polls every 10 seconds, as the requirement says', () => {
    expect(READINESS_POLL_MS).toBe(10_000);
  });
});
