import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../../test/axe';
import { mockReadiness } from '../../test/readiness';
import { renderWithProviders } from '../../test/render';
import { server } from '../../test/server';
import { ConnectionPanel } from './ConnectionPanel';

describe('ConnectionPanel', () => {
  it('shows a loading message at first', () => {
    mockReadiness('neverAnswers');
    renderWithProviders(<ConnectionPanel />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the connection status…');
  });

  it('when ready, says so and when it last checked', async () => {
    mockReadiness('ready');
    const { container } = renderWithProviders(<ConnectionPanel />);
    expect(await screen.findByText(/ledgerd is ready/)).toBeInTheDocument();
    expect(screen.getByText(/checks every 10 seconds/)).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('datetime');
    await expectNoAccessibilityViolations(container);
  });

  it('when not ready, explains what it means and that nothing is lost', async () => {
    mockReadiness('notReady');
    const { container } = renderWithProviders(<ConnectionPanel />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ledgerd is running but not ready');
    expect(alert).toHaveTextContent('usually because it cannot reach its database');
    expect(alert).toHaveTextContent('no data is lost');
    expect(alert).toHaveTextContent('the database cannot be reached'); // ledgerd's own detail
    expect(within(alert).getByRole('button', { name: 'Copy request id' })).toBeInTheDocument();
    await expectNoAccessibilityViolations(container);
  });

  it('when unreachable, says what to check', async () => {
    mockReadiness('unreachable');
    const { container } = renderWithProviders(<ConnectionPanel />);
    expect(await screen.findByText('Cannot reach the ledger')).toBeInTheDocument();
    expect(screen.getByText(/Check that ledgerd is running/)).toBeInTheDocument();
    await expectNoAccessibilityViolations(container);
  });

  it('when the key is rejected, points at the console configuration', async () => {
    mockReadiness('misconfigured');
    renderWithProviders(<ConnectionPanel />);
    expect(
      await screen.findByText('The console is not authorised to use the ledger'),
    ).toBeInTheDocument();
    expect(screen.getByText(/LEDGERD_API_KEY/)).toBeInTheDocument();
  });

  it('when the answer is not understood, says it is not trusted', async () => {
    mockReadiness('unexpectedBody');
    renderWithProviders(<ConnectionPanel />);
    expect(await screen.findByText('The answer was not understood')).toBeInTheDocument();
    expect(screen.queryByText(/ledgerd is ready/)).not.toBeInTheDocument();
  });

  it('"Check now" asks again at once and shows the new answer', async () => {
    const user = userEvent.setup();
    mockReadiness('notReady');
    renderWithProviders(<ConnectionPanel />);
    await screen.findByText('ledgerd is running but not ready');

    let calls = 0;
    server.use(
      http.get('*/api/readyz', () => {
        calls += 1;
        return HttpResponse.json({ status: 'ready' });
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(/ledgerd is ready/)).toBeInTheDocument();
    expect(calls).toBe(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is operated with the keyboard', async () => {
    const user = userEvent.setup();
    mockReadiness('ready');
    renderWithProviders(<ConnectionPanel />);
    await screen.findByText(/ledgerd is ready/);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Check now' })).toHaveFocus();
  });
});
