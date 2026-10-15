import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './server';

// The first test to open a lazily loaded page waits for its code to be transformed, which can
// take longer than the default one second when the whole suite is running.
configure({ asyncUtilTimeout: 8000 });

// jsdom has no matchMedia. By default the system is light and never changes; a test that needs
// otherwise replaces window.matchMedia itself.
window.matchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;

// jsdom has no <dialog>.showModal(). This stand-in opens and closes the element and fires
// `close`, which is all the components rely on. What a real browser adds (the top layer,
// focus trapping, Escape) is checked by the end-to-end tests.
if ((HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal === undefined) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, value?: string) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    if (value !== undefined) this.returnValue = value;
    this.dispatchEvent(new Event('close'));
  };
}

// Any request a test did not explicitly mock is an error: tests must not depend
// on a real network or a running API.
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
