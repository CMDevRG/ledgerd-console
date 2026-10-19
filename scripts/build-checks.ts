/*
 * The checks that run on what a build produced. Pure functions over file contents, so each can
 * be shown to fail; scripts/check-build.ts runs them on the real output.
 */

export interface Problem {
  file: string;
  message: string;
}

export interface OutputFile {
  path: string;
  content: Buffer;
}

// ---- 1. The API key must not be in anything emitted --------------------------------------

/**
 * The ways a secret can appear in a file: as it is, URL-encoded, in hexadecimal, and in base64
 * (which has three forms, depending on where in a 3-byte group the secret starts). Searching
 * for all of them catches a key that was encoded on the way, not only one pasted in.
 */
export function secretForms(secret: string): { form: string; needle: string }[] {
  const bytes = Buffer.from(secret, 'utf8');
  const forms = [
    { form: 'as it is', needle: secret },
    { form: 'URL-encoded', needle: encodeURIComponent(secret) },
    { form: 'hexadecimal', needle: bytes.toString('hex') },
  ];
  for (const offset of [0, 1, 2]) {
    const padded = Buffer.concat([Buffer.alloc(offset), bytes])
      .toString('base64')
      .replaceAll('=', '');
    // Leading characters depend on the bytes before the secret; trailing ones on the bytes after.
    const lead = [0, 2, 3][offset] ?? 0;
    const tail = [0, 2, 1][(offset + bytes.length) % 3] ?? 0;
    const needle = padded.slice(lead, padded.length - tail);
    if (needle.length >= 8) {
      forms.push({ form: `base64 (alignment ${String(offset)})`, needle });
      forms.push({
        form: `base64url (alignment ${String(offset)})`,
        needle: needle.replaceAll('+', '-').replaceAll('/', '_'),
      });
    }
  }
  // Where two forms are the same text (a key with nothing to encode), report it once.
  const seen = new Set<string>();
  return forms.filter((f) => {
    if (f.needle === '' || seen.has(f.needle)) return false;
    seen.add(f.needle);
    return true;
  });
}

/** Finds a secret, in any of its forms, in any of the files. */
export function findSecret(files: readonly OutputFile[], secret: string): Problem[] {
  const forms = secretForms(secret);
  return files.flatMap((file) =>
    forms
      .filter((f) => file.content.includes(f.needle))
      .map((f) => ({ file: file.path, message: `contains the API key (${f.form})` })),
  );
}

// ---- 2. The page must satisfy the Content Security Policy -------------------------------

/**
 * Looks in an HTML file for what the policy (script-src 'self'; style-src 'self') would block:
 * scripts and styles written in the page, event handler attributes, `javascript:` addresses, and
 * anything loaded from another origin.
 */
export function checkHtml(html: string, file: string): Problem[] {
  const problems: Problem[] = [];
  const add = (message: string): void => {
    problems.push({ file, message });
  };

  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    if (!/\bsrc\s*=/.test(attributes)) add('an inline script (a <script> without src)');
    else if (body.trim() !== '') add('a <script src> that also has code inside it');
    if (/\btype\s*=\s*["']?importmap/i.test(attributes))
      add('an import map, which is inline JSON the policy treats as script');
  }
  if (/<style\b/i.test(html)) add('an inline <style> element');
  if (/\sstyle\s*=/i.test(html)) add('a style="" attribute');
  if (/\son[a-z]+\s*=/i.test(html)) add('an event handler attribute (onclick=, onload=...)');
  if (/javascript\s*:/i.test(html)) add('a javascript: address');
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(html)) add('a meta refresh');

  for (const match of html.matchAll(/\b(?:src|href|action|data)\s*=\s*["']([^"']+)["']/gi)) {
    const value = match[1] ?? '';
    // Same-origin paths are fine; anything with a scheme or "//" is another origin (data: URIs
    // in src would be inline content too).
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value))
      add(`a reference to another origin or scheme: ${value}`);
  }
  return problems;
}

// ---- 3. The browser code must not know how to authenticate ------------------------------

/**
 * The API key belongs to the console server, which adds the Authorization header. Code in the
 * browser bundle that builds one would mean the browser holds, or is meant to hold, the key.
 */
export function checkClientBundle(files: readonly OutputFile[]): Problem[] {
  const forbidden: [RegExp, string][] = [
    [/Bearer\s/, 'builds a "Bearer" credential'],
    [/["'`]authorization["'`]/i, 'names the Authorization header'],
    [/\bVITE_[A-Z_]*KEY\b/, 'reads a VITE_ variable that looks like a key'],
  ];
  return files
    .filter((f) => /\.(?:js|mjs|html)$/.test(f.path))
    .flatMap((file) => {
      const text = file.content.toString('utf8');
      return forbidden
        .filter(([pattern]) => pattern.test(text))
        .map(([, message]) => ({ file: file.path, message }));
    });
}

/** What was emitted (source maps included), as a list that can be checked. */
export const isEmittedText = (path: string): boolean =>
  /\.(?:js|mjs|css|html|map|json|svg|txt)$/.test(path);
