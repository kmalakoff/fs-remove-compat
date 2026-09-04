# fs-remove-compat

Cross-platform file removal utilities with Node.js 0.8+ compatibility.

## Features

- **Strict ponyfills**: `rm` and `rmSync` exactly match Node.js `fs.rm`/`fs.rmSync` API
- **Enhanced variants**: `safeRm` and `safeRmSync` with Windows-friendly defaults
- **Node 0.8+ support**: Works on all Node.js versions
- **Zero dependencies**: Pure Node.js implementation
- **Migration codemod**: Auto-migrate from rimraf2

## Installation

```bash
npm install fs-remove-compat
```

## Usage

### Strict Ponyfills (match Node.js fs.rm)

```typescript
import { rm, rmSync } from 'fs-remove-compat';

// Remove a file
rmSync('/path/to/file.txt');

// Remove directory recursively
rmSync('/path/to/dir', { recursive: true });

// Ignore if doesn't exist
rmSync('/path/to/maybe', { force: true });

// Async with callback
rm('/path/to/file.txt', (err) => {
  if (err) console.error(err);
});

// Async with Promise
await rm('/path/to/file.txt');
await rm('/path/to/dir', { recursive: true, force: true });
```

### Enhanced Variants (Windows-friendly)

```typescript
import { safeRm, safeRmSync } from 'fs-remove-compat';

// safeRm/safeRmSync have Windows-friendly defaults:
// - recursive: true, force: true
// - maxRetries: 10 on Windows, 0 on POSIX
// - Linear backoff per entry (retryDelay * attempt), the schedule Node.js fs.rm uses
// - EPERM chmod fix for read-only files; EPERM from lstat is retried so a file whose
//   delete is still pending (a handle another process holds) is waited out

// Use for CI/test cleanup where Windows file locking is common
safeRmSync('/path/to/dir', { recursive: true, force: true });
await safeRm('/path/to/dir', { recursive: true, force: true });
```

## API

### Options

```typescript
interface RmOptions {
  recursive?: boolean;   // Remove directories recursively. Default: false
  force?: boolean;       // Ignore ENOENT errors. Default: false
  maxRetries?: number;   // Retries per entry on EBUSY/EPERM/etc. Default: 0 (or 10 on Windows for safe*)
  retryDelay?: number;   // Base delay between retries in ms, grows linearly. Default: 100
}
```

### rm(path, [options], [callback])

Removes a file or directory. Matches Node.js `fs.rm` signature.

### rmSync(path, [options])

Synchronous version. Matches Node.js `fs.rmSync` signature.

### safeRm(path, [options], [callback])

Enhanced version with Windows-friendly defaults.

### safeRmSync(path, [options])

Synchronous enhanced version.

## Migration from rimraf2

The package includes a smart migration codemod:

```bash
npx fs-remove-compat migrate <directory>
```

### Smart Detection

The codemod automatically chooses the right function based on file location:

**Source files** (`src/`) - Uses strict ponyfill:
- `rm` / `rmSync` - exactly matches Node.js behavior
- Apps should know immediately if removal fails

**Test files** (`test/`) - Uses enhanced variant:
- `safeRm` / `safeRmSync` - Windows-friendly retry defaults
- Retry is acceptable for test cleanup

### Transformations

| Context | Before | After |
|---------|--------|-------|
| Source | `rimraf2(p, {disableGlob:true}, cb)` | `rm(p, cb)` |
| Source | `rimraf2.sync(p, {disableGlob:true})` | `rmSync(p)` |
| Test | `rimraf2(p, {disableGlob:true}, cb)` | `safeRm(p, cb)` |
| Test | `rimraf2.sync(p, {disableGlob:true})` | `safeRmSync(p)` |

## Why use this?

1. **Replace rimraf2** without the `{ disableGlob: true }` boilerplate
2. **Cross-platform** with automatic Windows retry logic
3. **Future-proof** - `rm`/`rmSync` use native `fs.rm` when available (Node 14.14+); `safeRm`/`safeRmSync` use one walk on every version so retries stay bounded per entry
4. **Backwards compatible** - works on Node 0.8+

## License

MIT
