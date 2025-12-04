/**
 * fs-remove-compat
 *
 * Cross-platform file removal utilities with Node.js 0.8+ compatibility.
 *
 * Exports:
 * - rm, rmSync: Strict ponyfills matching Node.js fs.rm/fs.rmSync API
 * - safeRm, safeRmSync: Enhanced variants with Windows-friendly defaults
 */

// Strict ponyfills (match Node.js fs.rm behavior)
export { default as rm } from './rm.ts';
export { default as rmSync } from './rmSync.ts';

// Enhanced variants (Windows-friendly defaults)
export { default as safeRm } from './safeRm.ts';
export { default as safeRmSync } from './safeRmSync.ts';

// Types
export type { RmCallback, RmOptions } from './types.ts';
