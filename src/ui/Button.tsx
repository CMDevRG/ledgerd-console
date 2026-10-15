import type { ComponentProps, MouseEvent } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant;
  /** An operation is running. The button stays focusable but ignores clicks (no double submit). */
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'border-blue-800 bg-blue-800 text-white hover:bg-blue-900 dark:border-blue-300 dark:bg-blue-300 dark:text-slate-950 dark:hover:bg-blue-200',
  secondary:
    'border-slate-400 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-500 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
  danger:
    'border-red-800 bg-red-800 text-white hover:bg-red-900 dark:border-red-300 dark:bg-red-300 dark:text-slate-950 dark:hover:bg-red-200',
};

/**
 * A button. `loading` uses aria-disabled instead of `disabled`, so a keyboard user's focus
 * is not thrown away when they press it, and the click is ignored here.
 */
export function Button({
  variant = 'secondary',
  loading = false,
  type = 'button',
  className = '',
  children,
  onClick,
  disabled,
  ...rest
}: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      type={type}
      {...rest}
      disabled={disabled}
      aria-disabled={loading ? true : undefined}
      aria-busy={loading ? true : undefined}
      onClick={handleClick}
      className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-progress aria-disabled:opacity-70 ${VARIANTS[variant]} ${className}`}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
        />
      ) : null}
      {children}
    </button>
  );
}
