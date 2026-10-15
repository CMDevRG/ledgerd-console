import { useId, type ComponentProps, type ReactNode } from 'react';

interface TableProps {
  caption: ReactNode;
  /** Keep the caption for screen readers only (the page heading already says it). */
  hideCaption?: boolean;
  children: ReactNode;
}

/**
 * A data table with real table semantics and a caption. A wide table scrolls inside its own
 * container, which is focusable (so a keyboard user can scroll it) and named by the caption,
 * and the page itself never scrolls sideways.
 */
export function Table({ caption, hideCaption = false, children }: TableProps) {
  const id = useId();
  return (
    <div
      role="region"
      aria-labelledby={id}
      // The container must be focusable for keyboard users to scroll it (WCAG 2.1.1).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-md border border-slate-300 dark:border-slate-600"
    >
      <table className="w-full border-collapse text-left text-sm">
        <caption
          id={id}
          className={hideCaption ? 'sr-only' : 'p-3 text-left text-base font-semibold'}
        >
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function Th({
  numeric = false,
  className = '',
  scope = 'col',
  ...rest
}: ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <th
      scope={scope}
      {...rest}
      className={`border-b border-slate-300 bg-slate-100 px-3 py-2 font-semibold dark:border-slate-600 dark:bg-slate-800 ${numeric ? 'text-right' : ''} ${className}`}
    />
  );
}

export function Td({
  numeric = false,
  className = '',
  ...rest
}: ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      {...rest}
      className={`border-b border-slate-200 px-3 py-2 align-top dark:border-slate-700 ${numeric ? 'text-right tabular-nums' : ''} ${className}`}
    />
  );
}
