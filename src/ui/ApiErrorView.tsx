import { ApiError } from '../api/problem';
import { Button } from './Button';
import { CopyText } from './CopyText';

interface ApiErrorViewProps {
  error: unknown;
  /** Offered where trying again can help (not for a refusal, which would be refused again). */
  onRetry?: () => void;
  /** Leave out the list of field errors, when the form already shows them beside the fields. */
  hideFieldErrors?: boolean;
}

interface Presentation {
  title: string;
  explanation: string;
  retry: boolean;
}

/**
 * Says what went wrong with an API call, and what to do next, for every kind of failure
 * (requirement R12). It never shows a stack trace or a raw JSON body, and the request id is
 * always there to copy so the failure can be found in the logs.
 */
export function ApiErrorView({ error, onRetry, hideFieldErrors = false }: ApiErrorViewProps) {
  if (!(error instanceof ApiError)) {
    return (
      <Box>
        <Heading>The console hit an unexpected problem</Heading>
        <p>Reload the page. If it keeps happening, the console has a bug.</p>
        <Actions>
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload the page
          </Button>
        </Actions>
      </Box>
    );
  }

  const present = describe(error);
  const fieldErrors = Object.entries(error.fieldErrors);
  return (
    <Box>
      <Heading>{present.title}</Heading>
      <p>{present.explanation}</p>
      {error.kind === 'refused' && error.problem?.detail !== undefined ? (
        <p>{error.problem.detail}</p>
      ) : null}
      {!hideFieldErrors && fieldErrors.length > 0 ? (
        <ul className="list-disc pl-5">
          {fieldErrors.map(([field, message]) => (
            <li key={field}>
              <code>{field}</code>: {message}
            </li>
          ))}
        </ul>
      ) : null}
      {error.code === undefined ? null : (
        <p>
          Code: <code>{error.code}</code>
        </p>
      )}
      {error.requestId === undefined ? null : (
        <p className="flex flex-wrap items-center gap-2">
          Request id: <CopyText value={error.requestId} label="request id" head={8} tail={6} />
        </p>
      )}
      {present.retry && onRetry !== undefined ? (
        <Actions>
          <Button onClick={onRetry}>Try again</Button>
        </Actions>
      ) : null}
    </Box>
  );
}

function describe(error: ApiError): Presentation {
  if (error.code === 'console_misconfigured') {
    return {
      title: 'The console is not authorised to use the ledger',
      explanation:
        "ledgerd refused the console server's API key. Check LEDGERD_API_KEY in the console server's configuration, then reload.",
      retry: true,
    };
  }
  switch (error.kind) {
    case 'refused':
      return {
        title: error.problem?.title ?? 'The ledger refused this request',
        explanation:
          'The ledger understood the request and refused it. Change it and send it again.',
        retry: false,
      };
    case 'busy':
      return {
        title: 'The ledger is busy',
        explanation:
          error.retryAfterSeconds === undefined
            ? 'It asked to be tried again shortly.'
            : `It asked to be tried again in ${String(error.retryAfterSeconds)} ${error.retryAfterSeconds === 1 ? 'second' : 'seconds'}.`,
        retry: true,
      };
    case 'network':
      return {
        title: 'Cannot reach the ledger',
        explanation: `${error.message} Check that ledgerd is running and that the console server can reach it, then try again.`,
        retry: true,
      };
    case 'unexpected':
      return {
        title: 'The answer was not understood',
        explanation:
          'The ledger answered, but not in the form this console expects. This usually means the console and ledgerd are different versions.',
        retry: true,
      };
  }
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border-2 border-red-800 bg-red-50 p-4 text-sm text-red-950 dark:border-red-300 dark:bg-red-950 dark:text-red-50"
    >
      {children}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="text-base font-semibold">{children}</p>;
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2">{children}</div>;
}
