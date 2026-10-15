import { READINESS_VIEWS, useAnnounceReadinessChanges, useReadinessState } from './readiness';

/**
 * The connection status shown on every page. The meaning is in the words and the symbol, not
 * only in the colour. Changes are announced through the page's live region (see
 * useAnnounceReadinessChanges), so this element itself is not a live region.
 */
export function ReadinessBadge() {
  const { state } = useReadinessState();
  useAnnounceReadinessChanges(state);
  const view = READINESS_VIEWS[state];

  return (
    <p
      data-state={state}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${view.tone}`}
    >
      <span aria-hidden="true">{view.symbol}</span>
      {view.label}
    </p>
  );
}
