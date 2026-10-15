/** Shown while a view has nothing to show yet. */
export function Loading({ what }: { what: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
      <span
        aria-hidden="true"
        className="size-4 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
      />
      Loading {what}…
    </p>
  );
}

/**
 * Marks data that is on screen but being refreshed in the background. The old data stays
 * (requirement R12.4). This is visual only: announcing every ten-second poll would be noise.
 */
export function Refreshing({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`text-xs text-slate-700 dark:text-slate-300 ${active ? '' : 'invisible'}`}
    >
      Refreshing…
    </span>
  );
}
