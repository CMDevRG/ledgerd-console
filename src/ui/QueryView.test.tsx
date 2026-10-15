import { useQuery } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { request } from '../api/client';
import { z } from 'zod';
import { expectNoAccessibilityViolations } from '../test/axe';
import { renderWithProviders } from '../test/render';
import { server } from '../test/server';
import { QueryView } from './QueryView';

const schema = z.object({ items: z.array(z.string()) });

function Example() {
  const query = useQuery({
    queryKey: ['items'],
    queryFn: ({ signal }) => request({ path: '/things', schema, signal }),
    retry: false,
  });
  return (
    <QueryView query={{ ...query, data: query.data?.data }} what="things">
      {(data) => (
        <ul>
          {data.items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </QueryView>
  );
}

const items = (...names: string[]) =>
  http.get('*/api/things', () => HttpResponse.json({ items: names }));
const fails = () => http.get('*/api/things', () => HttpResponse.error());

describe('QueryView', () => {
  it('shows a loading message, then the data', async () => {
    server.use(items('one', 'two'));
    const { container } = renderWithProviders(<Example />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading things…');
    expect(await screen.findByText('one')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
    await expectNoAccessibilityViolations(container);
  });

  it('shows an explanation and a retry, never an empty view, when the first load fails', async () => {
    const user = userEvent.setup();
    server.use(fails());
    const { container } = renderWithProviders(<Example />);
    expect(await screen.findByText('Cannot reach the ledger')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    await expectNoAccessibilityViolations(container);

    server.use(items('recovered'));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('recovered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps showing the earlier data, with the explanation, when a refresh fails', async () => {
    const user = userEvent.setup();
    server.use(items('earlier'));
    function WithRefresh() {
      const query = useQuery({
        queryKey: ['items'],
        queryFn: ({ signal }) => request({ path: '/things', schema, signal }),
        retry: false,
      });
      return (
        <>
          <button type="button" onClick={() => void query.refetch()}>
            refresh
          </button>
          <QueryView query={{ ...query, data: query.data?.data }} what="things">
            {(data) => <p>{data.items.join(',')}</p>}
          </QueryView>
        </>
      );
    }
    const { container } = renderWithProviders(<WithRefresh />);
    await screen.findByText('earlier');

    server.use(fails());
    await user.click(screen.getByRole('button', { name: 'refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the ledger');
    expect(screen.getByText('earlier')).toBeInTheDocument();
    expect(screen.getByText(/Showing the things loaded earlier/)).toBeInTheDocument();
    await expectNoAccessibilityViolations(container);
  });

  it('marks the data as refreshing while it is refreshed, and keeps it on screen', async () => {
    const user = userEvent.setup();
    server.use(items('stay'));
    function WithRefresh() {
      const query = useQuery({
        queryKey: ['items'],
        queryFn: ({ signal }) => request({ path: '/things', schema, signal }),
      });
      return (
        <>
          <button type="button" onClick={() => void query.refetch()}>
            refresh
          </button>
          <QueryView query={{ ...query, data: query.data?.data }} what="things">
            {(data) => <p>{data.items.join(',')}</p>}
          </QueryView>
        </>
      );
    }
    renderWithProviders(<WithRefresh />);
    await screen.findByText('stay');
    expect(screen.getByText('Refreshing…')).toHaveClass('invisible');

    server.use(http.get('*/api/things', () => new Promise(() => undefined)));
    await user.click(screen.getByRole('button', { name: 'refresh' }));
    expect(await screen.findByText('Refreshing…')).not.toHaveClass('invisible');
    expect(screen.getByText('stay')).toBeInTheDocument();
  });
});
