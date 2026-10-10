import { join, sep } from 'path';
import url from 'url';
import type { RmPath } from '../types.ts';
import { fileURLToPath } from './fileURLToPath.ts';
import { invalidType } from './options.ts';

export type FsPath = string | Buffer;
export const HAS_BUFFER_PATHS = parseInt(process.versions.node.split('.')[0], 10) >= 6;
const IS_WIN32 = process.platform === 'win32';
// Raw-byte entries are POSIX-only: Windows keeps strings so Node adds the \\?\ prefix for paths over MAX_PATH.
export const READ_BUFFER_ENTRIES = HAS_BUFFER_PATHS && !IS_WIN32;

export function toBuffer(value: string): Buffer {
  return typeof Buffer.from === 'function' ? Buffer.from(value) : new Buffer(value);
}

export function validatePath(path: RmPath): FsPath {
  let result: FsPath;
  if (typeof url.URL === 'function' && path instanceof url.URL) {
    result = fileURLToPath(path);
  } else if (typeof path === 'string' || Buffer.isBuffer(path)) {
    result = path;
  } else if (HAS_BUFFER_PATHS && typeof Uint8Array === 'function' && path instanceof Uint8Array) {
    result = Buffer.from(path);
  } else {
    throw invalidType('path', 'a string, Buffer, or file URL');
  }
  let hasNull = typeof result === 'string' && result.indexOf('\0') !== -1;
  if (Buffer.isBuffer(result)) {
    for (let i = 0; i < result.length; i++) {
      if (result[i] === 0) hasNull = true;
    }
  }
  if (hasNull) {
    const error = new TypeError('The path must not contain null bytes.') as NodeJS.ErrnoException;
    error.code = 'ERR_INVALID_ARG_VALUE';
    throw error;
  }
  if (Buffer.isBuffer(result) && !HAS_BUFFER_PATHS) {
    const text = result.toString();
    if (toBuffer(text).toString('hex') !== result.toString('hex')) throw invalidType('path', 'a UTF-8 Buffer on Node before 6');
    return text;
  }
  if (Buffer.isBuffer(result) && IS_WIN32) return result.toString();
  return result;
}

export function childPath(parent: FsPath, entry: FsPath): FsPath {
  if (typeof parent === 'string' && typeof entry === 'string') return join(parent, entry);
  return Buffer.concat([typeof parent === 'string' ? toBuffer(parent) : parent, toBuffer(sep), typeof entry === 'string' ? toBuffer(entry) : entry]);
}
