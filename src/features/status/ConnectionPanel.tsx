import { ApiError } from '../../api/problem';
import { ApiErrorView } from '../../ui/ApiErrorView';
import { Button } from '../../ui/Button';
import { CopyText } from '../../ui/CopyText';
import { Loading } from '../../ui/Status';
import { Time } from '../../ui/Time';
import { READINESS_POLL_MS, READINESS_VIEWS, useReadinessState } from './readiness';

const SECONDS = READINESS_POLL_MS / 1000;

/**
 * The connection to ledgerd explained in full: what state it is in, what that means, what
 * to do, and a button to check again now.
 */
export function ConnectionPanel() {
  const { query, state } = useReadinessState();
  const view = READINESS_VIEWS[state];
  const check = (): void => {
    void query.refetch();
  };

  return (
    <section aria-labelledby="connection" className="flex flex-col gap-3">
      <h2 id="connection" className="text-lg font-semibold">
        Connection to ledgerd
      </h2>

      {state === 'checking' ? <Loading what="the connection status" /> : null}

      {state === 'ready' ? (
        <>
          <p>
            <span aria-hidden="true">{view.symbol} </span>
            ledgerd is ready: it is running and can reach its database.
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            The console checks every {SECONDS} seconds. Last checked{' '}
            <Time iso={new Date(query.dataUpdatedAt).toISOString()} />.
          </p>
        </>
      ) : null}

      {state === 'not_ready' && query.error instanceof ApiError ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border-2 border-amber-700 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-300 dark:bg-amber-950 dark:text-amber-50"
        >
          <p className="text-base font-semibold">
            <span aria-hidden="true">{view.symbol} </span>
            ledgerd is running but not ready
          </p>
          <p>
            It is not ready to take requests, usually because it cannot reach its database. Nothing
            you do in the console will work until it is ready, and no data is lost. The console
            checks again every {SECONDS} seconds.
          </p>
          {query.error.problem?.detail === undefined ? null : <p>{query.error.problem.detail}</p>}
          {query.error.requestId === undefined ? null : (
            <p className="flex flex-wrap items-center gap-2">
              Request id: <CopyText value={query.error.requestId} label="request id" />
            </p>
          )}
        </div>
      ) : null}

      {state === 'unreachable' || state === 'misconfigured' || state === 'unexpected' ? (
        <ApiErrorView error={query.error} />
      ) : null}

      <div>
        <Button onClick={check} loading={query.isFetching && state !== 'checking'}>
          Check now
        </Button>
      </div>
    </section>
  );
}
