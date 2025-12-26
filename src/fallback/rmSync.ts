import fs from 'fs';
import type { RmOptions } from '../types.ts';
import { fixWinEPERMSync, shouldFixEPERM } from './fixWinEPERM.ts';

const RETRYABLE_CODES = ['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'];

/**
 * Busy-wait for sync retry delay.
 */
function busyWait(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy wait
  }
}

/**
 * Remove a file synchronously.
 */
function unlinkSync(path: string, options: Required<RmOptions>): void {
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      fs.unlinkSync(path);
      return;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;

      // Handle ENOENT
      if (error.code === 'ENOENT') {
        if (options.force) return;
        throw error;
      }

      // Try EPERM fix on Windows
      if (shouldFixEPERM(error)) {
        try {
          fixWinEPERMSync(path, error);
          return;
        } catch (_fixErr) {
          // Fall through to retry logic
        }
      }

      // Check if retryable
      if (RETRYABLE_CODES.indexOf(error.code || '') === -1 || attempt >= options.maxRetries) {
        throw error;
      }

      // Wait before retry (linear backoff like Node.js)
      busyWait(options.retryDelay);
    }
  }
}

/**
 * Remove a directory synchronously (non-recursive).
 */
function rmdirSync(path: string, options: Required<RmOptions>): void {
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      fs.rmdirSync(path);
      return;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;

      if (error.code === 'ENOENT') {
        if (options.force) return;
        throw error;
      }

      if (RETRYABLE_CODES.indexOf(error.code || '') === -1 || attempt >= options.maxRetries) {
        throw error;
      }

      busyWait(options.retryDelay);
    }
  }
}

/**
 * Remove directory contents recursively.
 */
function rmdirRecursiveSync(path: string, options: Required<RmOptions>): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(path);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT' && options.force) return;
    throw error;
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryPath = `${path}/${entry}`;
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(entryPath);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT' && options.force) continue;
      throw error;
    }

    if (stats.isDirectory()) {
      rmdirRecursiveSync(entryPath, options);
    } else {
      unlinkSync(entryPath, options);
    }
  }

  // Now remove the directory itself
  rmdirSync(path, options);
}

/**
 * Fallback rmSync implementation for Node < 14.14.
 * Matches Node.js fs.rmSync API.
 */
export default function fallbackRmSync(path: string, options?: RmOptions): void {
  const opts: Required<RmOptions> = {
    recursive: options?.recursive ?? false,
    force: options?.force ?? false,
    maxRetries: options?.maxRetries ?? 0,
    retryDelay: options?.retryDelay ?? 100,
  };

  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(path);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      if (opts.force) return;
      throw error;
    }
    throw error;
  }

  if (stats.isDirectory()) {
    if (!opts.recursive) {
      const err = new Error(`EISDIR: illegal operation on a directory, rm '${path}'`) as NodeJS.ErrnoException;
      err.code = 'EISDIR';
      err.syscall = 'rm';
      err.path = path;
      throw err;
    }
    rmdirRecursiveSync(path, opts);
  } else {
    unlinkSync(path, opts);
  }
}
