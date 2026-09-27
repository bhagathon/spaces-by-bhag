/**
 * Script-bearing schemes. A Space or resource can arrive from sync (a teammate's
 * edit), so a URL is never trusted for opening or linking just because it's stored.
 */
const UNSAFE = /^\s*(javascript|data|vbscript):/i;

export const isSafeUrl = (url: string | undefined): url is string => !!url && !UNSAFE.test(url);
