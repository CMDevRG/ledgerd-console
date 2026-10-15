import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Announce = (message: string) => void;

const AnnounceContext = createContext<Announce>(() => undefined);

/**
 * One polite live region for the whole application. Results of actions (a copy, a success,
 * a refusal) are announced to screen readers through it without moving focus (WCAG 4.1.3).
 */
export function LiveRegionProvider({ children }: { children: ReactNode }) {
  // Saying the same thing twice must be announced twice, but a region that does not change
  // is silent; a counter makes every message a change.
  const [state, setState] = useState({ message: '', count: 0 });
  const announce = useCallback<Announce>((message) => {
    setState((s) => ({ message, count: s.count + 1 }));
  }, []);
  const value = useMemo(() => announce, [announce]);

  return (
    <AnnounceContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {state.message}
        {state.count % 2 === 0 ? '' : '\u00A0'}
      </div>
    </AnnounceContext.Provider>
  );
}

/** A function that announces a message; does nothing outside a LiveRegionProvider. */
export function useAnnounce(): Announce {
  return useContext(AnnounceContext);
}
