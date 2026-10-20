import { problemCode } from './helpers';
import type { Exchange } from './types';

/** JSON as text, indented; text stays text. */
function show(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function Headers({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return <p className="text-xs">No headers of interest.</p>;
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] [&_dd]:[overflow-wrap:anywhere] gap-x-3 font-mono text-xs">
      {entries.map(([name, value]) => (
        <div key={name} className="contents">
          <dt>{name}:</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Body({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return <p className="text-xs">No body.</p>;
  return (
    <pre
      // Focusable, so the keyboard can scroll a long body.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label={label}
      className="max-h-72 overflow-auto rounded border border-slate-300 bg-slate-50 p-2 text-xs dark:border-slate-600 dark:bg-slate-900"
    >
      {show(value)}
    </pre>
  );
}

/**
 * One request and its answer, as they were. A native disclosure: the summary line says what
 * happened, and opening it shows the headers and bodies. The API key is not in it: the browser
 * never has it, and only a short list of headers is ever recorded.
 */
export function ExchangeView({ exchange, n }: { exchange: Exchange; n: number }) {
  const code = problemCode(exchange);
  return (
    <details className="rounded-md border border-slate-300 p-2 dark:border-slate-600">
      <summary className="cursor-pointer text-sm">
        <span className="font-medium">Request {n}:</span>{' '}
        <span className="font-mono">
          {exchange.method} {exchange.path}
        </span>{' '}
        → <strong>{exchange.status}</strong>
        {code === undefined ? null : <code className="ml-1 font-mono">{code}</code>}
        <span className="ml-2 text-xs text-slate-700 dark:text-slate-300">{exchange.ms} ms</span>
      </summary>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-sm font-semibold">Sent</h4>
          <Headers headers={exchange.requestHeaders} />
          <Body label={`Body sent in request ${String(n)}`} value={exchange.body} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-sm font-semibold">Received</h4>
          <Headers headers={exchange.responseHeaders} />
          <Body label={`Body received in request ${String(n)}`} value={exchange.responseBody} />
        </div>
      </div>
    </details>
  );
}
