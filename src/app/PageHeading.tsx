import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

/** True once the user has moved to another page (not on the first load). */
export const NavigatedContext = createContext(false);

interface PageHeadingProps {
  /** The page's name: the heading, and the start of the tab title. */
  title: string;
  children?: ReactNode;
}

/**
 * The single <h1> of a page. It also sets the tab title, and when the user arrives by
 * navigating (not on the first load) it takes focus, so a screen reader announces the new
 * page and a keyboard user starts at the top of it (WCAG 2.4.2, 2.4.3, 2.4.6).
 */
export function PageHeading({ title, children }: PageHeadingProps) {
  const navigated = useContext(NavigatedContext);
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${title} · ledgerd console`;
  }, [title]);

  useEffect(() => {
    if (navigated) ref.current?.focus();
    // Only when the page appears; a later title change must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 ref={ref} tabIndex={-1} className="text-2xl font-semibold outline-offset-4">
        {title}
      </h1>
      {children}
    </div>
  );
}
