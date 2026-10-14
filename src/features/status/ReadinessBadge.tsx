import { ApiError } from '../../api/problem';
import { useReadiness } from './useReadiness';

export function ReadinessBadge() {
  const { isPending, isError, error } = useReadiness();

  let label: string;
  let tone: string;
  if (isPending) {
    label = 'Checking API…';
    tone = 'bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100';
  } else if (!isError) {
    label = 'API ready';
    tone = 'bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100';
  } else if (error instanceof ApiError && (error.kind === 'refused' || error.kind === 'busy')) {
    label = 'API not ready';
    tone = 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100';
  } else if (error instanceof ApiError && error.kind === 'unexpected') {
    label = 'Unexpected answer from the API';
    tone = 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100';
  } else {
    label = 'Cannot reach the API';
    tone = 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100';
  }

  // role="status" announces changes to screen readers without stealing focus.
  return (
    <span role="status" className={`rounded-full px-3 py-1 text-sm font-medium ${tone}`}>
      {label}
    </span>
  );
}
