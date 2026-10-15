import { useId, type ComponentProps, type ReactNode } from 'react';

/** What a control needs to be tied to its label, hint and error. */
export interface ControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  required: true | undefined;
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** The validation message, if the value is wrong. */
  error?: string | undefined;
  required?: boolean;
  className?: string;
  /** Renders the control with the props that connect it to the label, hint and error. */
  children: (control: ControlProps) => ReactNode;
}

/**
 * A labelled form control. The label is a real <label>, and the hint and the error are
 * associated through aria-describedby, so a screen reader reads them with the control. The
 * error says "Error:" in words and is not shown by colour alone.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  className = '',
  children,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint === undefined ? undefined : hintId, error === undefined ? undefined : errorId]
      .filter((x) => x !== undefined)
      .join(' ') || undefined;

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required ? (
          <span className="font-normal text-slate-700 dark:text-slate-300"> (required)</span>
        ) : null}
      </label>
      {hint === undefined ? null : (
        <p id={hintId} className="text-sm text-slate-700 dark:text-slate-300">
          {hint}
        </p>
      )}
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error === undefined ? undefined : true,
        required: required ? true : undefined,
      })}
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-red-800 dark:text-red-300">
          <span className="font-semibold">Error:</span> {error}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  'w-full rounded-md border border-slate-500 bg-white px-3 py-2 text-sm text-slate-900 aria-[invalid=true]:border-2 aria-[invalid=true]:border-red-700 disabled:opacity-60 dark:border-slate-400 dark:bg-slate-900 dark:text-slate-100 dark:aria-[invalid=true]:border-red-300';

export function Input({ className = '', ...rest }: ComponentProps<'input'>) {
  return <input {...rest} className={`${CONTROL} ${className}`} />;
}

export function Select({ className = '', ...rest }: ComponentProps<'select'>) {
  return <select {...rest} className={`${CONTROL} ${className}`} />;
}
