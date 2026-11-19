import { randomBytes } from 'node:crypto';
import { iconScript, themeStyles } from './theme';

/**
 * HTML shell for redesigned pages: theme styles, icons and a strict CSP.
 * `resourceSource` is the webview's cspSource when the page shows local files (thumbnails, videos).
 */
export function themedPage(title: string, body: string, styles: string, script: string, resourceSource = '') {
  const nonce = randomBytes(18).toString('base64');
  const src = resourceSource ? ' ' + resourceSource : '';
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:${src}; media-src blob:${src}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">`
    + `<title>${title.replace(/[<&]/g, '')}</title><style>${themeStyles}${styles}</style></head><body>${body}`
    + `<script nonce="${nonce}">const api=acquireVsCodeApi();${iconScript}${script}\ndrawIcons();</script></body></html>`;
}

/** Escapes text for HTML on the host side. */
export function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
