import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../../test/server';
import { renderWithProviders } from '../../test/render';
import { ReadinessBadge } from './ReadinessBadge';

describe('ReadinessBadge', () => {
  it('shows a neutral state while the first check is running', () => {
    server.use(http.get('*/api/readyz', () => new Promise(() => undefined)));
    renderWithProviders(<ReadinessBadge />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking API');
  });

  it('shows ready when /readyz answers ready', async () => {
    server.use(http.get('*/api/readyz', () => HttpResponse.json({ status: 'ready' })));
    renderWithProviders(<ReadinessBadge />);
    expect(await screen.findByText('API ready')).toBeInTheDocument();
  });

  it('shows not ready when the API answers with a problem document', async () => {
    server.use(
      http.get('*/api/readyz', () =>
        HttpResponse.json(
          {
            type: 'urn:ledgerd:error:not_ready',
            title: 'Service not ready',
            status: 503,
            code: 'not_ready',
          },
          { status: 503, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    renderWithProviders(<ReadinessBadge />);
    expect(await screen.findByText('API not ready')).toBeInTheDocument();
  });

  it('shows unreachable when the network fails', async () => {
    server.use(http.get('*/api/readyz', () => HttpResponse.error()));
    renderWithProviders(<ReadinessBadge />);
    expect(await screen.findByText('Cannot reach the API')).toBeInTheDocument();
  });

  it('refuses a response that does not match the documented shape', async () => {
    // A proxy or a wrong server answering 200 with something else must not look "ready".
    server.use(http.get('*/api/readyz', () => HttpResponse.json({ status: 'fine, thanks' })));
    renderWithProviders(<ReadinessBadge />);
    expect(await screen.findByText('Unexpected answer from the API')).toBeInTheDocument();
  });
});
