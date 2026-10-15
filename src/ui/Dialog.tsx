import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  /** Called when the dialog is dismissed (Escape, or a button that closes it). */
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * A modal dialog built on the native <dialog> element: the browser makes the rest of the
 * page inert, traps focus and closes on Escape. When it closes, focus goes back to the
 * element that opened it (done here explicitly, so it holds in every browser and in tests).
 * The content is only rendered while it is open.
 */
export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const latest = useRef({ open, onClose });

  // Kept in an effect (not during render) so the close handler below sees the current props.
  useEffect(() => {
    latest.current = { open, onClose };
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = (): void => {
      opener.current?.focus();
      opener.current = null;
      // Closed by the browser (Escape) while the parent still thinks it is open: tell it.
      if (latest.current.open) latest.current.onClose();
    };
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('close', handleClose);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-slate-400 bg-white p-6 text-slate-900 backdrop:bg-black/60 dark:border-slate-500 dark:bg-slate-900 dark:text-slate-100"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      {open ? <div className="mt-3">{children}</div> : null}
    </dialog>
  );
}
