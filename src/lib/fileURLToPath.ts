import { sep } from 'path';
import url from 'url';

function invalidURL(code: string, message: string): NodeJS.ErrnoException {
  const error = new TypeError(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

/** Uses Node's built-in converter, with the same file URL rules for Node 7.6–10.11. */
export function fileURLToPath(value: url.URL): string {
  if (typeof url.fileURLToPath === 'function') return url.fileURLToPath(value);
  // Node's pre-10.12 filesystem URL conversion: https://github.com/nodejs/node/blob/v8.0.0/lib/internal/url.js
  if (value.protocol !== 'file:') throw invalidURL('ERR_INVALID_URL_SCHEME', 'The URL must use the file: protocol');
  const windows = sep === '\\';
  if (/%2f/i.test(value.pathname) || (windows && /%5c/i.test(value.pathname))) {
    throw invalidURL('ERR_INVALID_FILE_URL_PATH', 'File URLs must not contain encoded path separators');
  }
  if (!windows && value.hostname !== '') throw invalidURL('ERR_INVALID_FILE_URL_HOST', 'File URL host must be localhost or empty');
  const pathname = decodeURIComponent(value.pathname);
  if (!windows) return pathname;
  if (value.hostname !== '') return `\\\\${url.domainToUnicode(value.hostname)}${pathname.replace(/\//g, '\\')}`;
  if (!/^\/[a-z]:/i.test(pathname)) throw invalidURL('ERR_INVALID_FILE_URL_PATH', 'File URL must be absolute');
  return pathname.slice(1).replace(/\//g, '\\');
}
