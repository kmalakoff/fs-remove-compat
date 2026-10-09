import assert from 'assert';
import fs from 'fs';
import mkdirp from 'mkdirp-classic';
import path from 'path';
import type { RmOptions } from '../../src/types.ts';

export const invalidOptions: { options: unknown; code: string }[] = [
  ...[null, [], 'recursive', 1].map((options) => ({ options, code: 'ERR_INVALID_ARG_TYPE' })),
  ...['recursive', 'force'].map((key) => ({ options: { [key]: 'yes' }, code: 'ERR_INVALID_ARG_TYPE' })),
  ...['recursive', 'force', 'maxRetries', 'retryDelay'].map((key) => ({ options: { [key]: undefined }, code: 'ERR_INVALID_ARG_TYPE' })),
  ...['maxRetries', 'retryDelay'].map((key) => ({ options: { [key]: null }, code: 'ERR_INVALID_ARG_TYPE' })),
  ...[-1, 1.5, NaN, Infinity, 4294967296].map((maxRetries) => ({ options: { maxRetries }, code: 'ERR_OUT_OF_RANGE' })),
  ...[-1, 1.5, NaN, Infinity, 2147483648].map((retryDelay) => ({ options: { retryDelay }, code: 'ERR_OUT_OF_RANGE' })),
];

export function tree(root: string): void {
  mkdirp.sync(path.join(root, 'child'));
  fs.writeFileSync(path.join(root, 'child', 'keep.txt'), 'keep');
}

export function intact(root: string): void {
  assert.equal(fs.readFileSync(path.join(root, 'child', 'keep.txt'), 'utf8'), 'keep');
}

export function errorCode(operation: () => void): string | undefined {
  try {
    operation();
  } catch (error) {
    return (error as NodeJS.ErrnoException).code;
  }
  return undefined;
}

export const nativeRm = typeof fs.rm === 'function' ? fs.rm : undefined;
export const nativeRmSync = typeof fs.rmSync === 'function' ? fs.rmSync : undefined;
export function options(value: unknown): RmOptions {
  return value as RmOptions;
}

export const HAS_POSIX_PERMISSIONS = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0;
