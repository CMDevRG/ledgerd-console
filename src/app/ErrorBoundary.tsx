import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '../ui/Button';

interface Props {
  children: ReactNode;
  /** When this changes (the route, say), a shown error is cleared and the children try again. */
  resetKey?: unknown;
  /** For tests. */
  reload?: () => void;
}

interface State {
  failed: boolean;
}

/**
 * Catches an error thrown while rendering (or while loading a page's code) so that one broken
 * page does not blank the whole console: the navigation around it keeps working (R12.5).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // For the developer's console only: nothing from the error is put on the page.
    console.error('A part of the console failed to render:', error, info.componentStack);
  }

  override componentDidUpdate(previous: Props): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <FailureNotice
        onRetry={() => {
          this.setState({ failed: false });
        }}
        onReload={
          this.props.reload ??
          (() => {
            window.location.reload();
          })
        }
      />
    );
  }
}

/** What is shown instead of a part of the page that failed. Nothing from the error is in it. */
export function FailureNotice({
  onRetry,
  onReload,
}: {
  onRetry?: () => void;
  onReload: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-md border-2 border-red-800 bg-red-50 p-4 text-sm text-red-950 dark:border-red-300 dark:bg-red-950 dark:text-red-50"
    >
      <p className="text-base font-semibold">This part of the page could not be shown</p>
      <p>
        Something failed while drawing it. The rest of the console still works. Try again, and if it
        keeps failing, reload the page.
      </p>
      <div className="flex gap-2">
        {onRetry === undefined ? null : <Button onClick={onRetry}>Try again</Button>}
        <Button onClick={onReload}>Reload the page</Button>
      </div>
    </div>
  );
}
