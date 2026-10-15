import { useEffect, useState } from 'react';

import { useAnnounce } from './LiveRegion';

/** `3f2b8a52-2f8e-4c61-…-0d6f4f0e7c11` for a long value; short values are left whole. */
export function truncateMiddle(value: string, head = 8, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

interface CopyTextProps {
  value: string;
  /** What the value is ("account id"), used in the button name and the announcement. */
  label: string;
  head?: number;
  tail?: number;
}

/**
 * An identifier that is shown truncated in the middle (so it never breaks the layout), is
 * read in full by screen readers, and can be copied with a button.
 */
export function CopyText({ value, label, head, tail }: CopyTextProps) {
  const announce = useAnnounce();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => {
      setState('idle');
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const copy = (): void => {
    const done = (ok: boolean): void => {
      setState(ok ? 'copied' : 'failed');
      announce(ok ? `${label} copied` : `Could not copy the ${label}; select it and copy by hand`);
    };
    // navigator.clipboard exists only in secure contexts (https or localhost).
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    if (clipboard === undefined) {
      done(false);
      return;
    }
    clipboard.writeText(value).then(
      () => {
        done(true);
      },
      () => {
        done(false);
      },
    );
  };

  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <code className="min-w-0 font-mono text-sm">
        <span aria-hidden="true">{truncateMiddle(value, head, tail)}</span>
        <span className="sr-only">{value}</span>
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="shrink-0 rounded border border-slate-400 px-2 py-0.5 text-xs hover:bg-slate-100 dark:border-slate-500 dark:hover:bg-slate-800"
      >
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </button>
    </span>
  );
}
