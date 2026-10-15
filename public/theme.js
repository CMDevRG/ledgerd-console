/*
 * Sets the colour theme before the page is first painted, so a dark-mode user never sees a
 * white flash. It is a separate file, not an inline script, because the Content Security
 * Policy forbids inline scripts. It must agree with src/features/settings (the storage key and
 * the meaning of "system"); theme-script.test.ts checks that it does.
 */
(function () {
  var theme;
  try {
    var saved = JSON.parse(localStorage.getItem('ledgerd-console.settings') || '{}');
    theme = saved && saved.theme;
  } catch {
    /* Unreadable storage or damaged text: follow the system, like the application does. */
  }
  var dark = false;
  try {
    dark =
      theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  } catch {
    /* No matchMedia: stay light. */
  }
  document.documentElement.classList.toggle('dark', dark);
})();
