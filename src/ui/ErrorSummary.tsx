import { useEffect, useRef } from 'react';

export interface SummaryItem {
  /** Identifies the field, handed back to onSelect. */
  key: string;
  /** The field's name as the person knows it ("Currency"). */
  label: string;
  message: string;
}

interface ErrorSummaryProps {
  items: SummaryItem[];
  /** Focus moves to the summary whenever this changes (each failed submit). */
  focusKey: number;
  /** Called when a person chooses an item: move focus to that field. */
  onSelect: (key: string) => void;
}

/**
 * The list of what is wrong with a form, shown after a failed submit. It is an alert and takes
 * focus, so a screen reader reads it at once; each line is a button that jumps to its field.
 */
export function ErrorSummary({ items, focusKey, onSelect }: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusKey > 0) ref.current?.focus();
  }, [focusKey]);

  return (
    <div
      role="alert"
      ref={ref}
      tabIndex={-1}
      className="rounded-md border-2 border-red-800 bg-red-50 p-4 text-sm text-red-950 dark:border-red-300 dark:bg-red-950 dark:text-red-50"
    >
      <p className="font-semibold">
        {items.length === 1
          ? 'There is 1 problem to fix'
          : `There are ${String(items.length)} problems to fix`}
      </p>
      <ul className="mt-2 list-disc pl-5">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className="font-medium underline"
              onClick={() => {
                onSelect(item.key);
              }}
            >
              {item.label}
            </button>
            : {item.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
