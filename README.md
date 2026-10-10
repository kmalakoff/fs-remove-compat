# fs-remove-compat

Cross-platform file removal utilities with Node.js 0.8+ compatibility. The `rm` and `rmSync` functions use the native Node.js `fs.rm` APIs when available and backport their documented removal options on older runtimes. The `safeRm` and `safeRmSync` variants use Windows-friendly defaults for cleanup tasks.

## Install

```sh
npm install fs-remove-compat
```

## Use

This CommonJS example creates and removes a disposable file, then reports errors through the callback.

```js
var fs = require('fs');
var os = require('os');
var path = require('path');
var rm = require('fs-remove-compat').rm;

var file = path.join(os.tmpdir(), 'fs-remove-compat-example.txt');
fs.writeFileSync(file, 'temporary file');
rm(file, function (error) {
  if (error) throw error;
  console.log('Removed');
});
```

`rm` and `rmSync` default to `recursive: false`, `force: false`, and `maxRetries: 0`. `safeRm` and `safeRmSync` default to `recursive: true` and `force: true`; on Windows they retry removable errors up to 10 times. Pass `recursive: true` to remove a directory with the strict functions.

## API

```ts
interface RmOptions {
  recursive?: boolean;
  force?: boolean;
  maxRetries?: number;
  retryDelay?: number;
}
```

- `rm(path, [options], callback)` removes a file or directory asynchronously.
- `rmSync(path, [options])` removes a file or directory synchronously.
- `safeRm(path, [options], callback)` is the asynchronous cleanup variant.
- `safeRmSync(path, [options])` is the synchronous cleanup variant.

The asynchronous functions use Node-style callbacks. They do not return Promises. Use `safeRm` or `safeRmSync` for cleanup where Windows file locking is common. The strict functions use native `fs.rm` on Node 14.14 and newer, with a Windows symlink workaround, and a fallback on older versions. The safe functions always use the fallback so retries stay bounded per entry and the callback waits for in-flight removals.

All supported runtimes accept string and UTF-8 Buffer paths. File URLs are supported on Node 7.6 and newer. Node 6 and newer also support Buffer paths containing arbitrary filename bytes on POSIX. On Windows, a Buffer path is read as UTF-8, and trees whose paths exceed 260 characters are removed for string and Buffer paths alike. Invalid arguments throw before removal; filesystem errors reach the callback or throw from the synchronous functions. The fallback uses current Node error codes, while native validation messages can vary by Node version.

For the strict functions, `maxRetries` and `retryDelay` apply only with `recursive: true`. Safe functions retain their cleanup retries even when `recursive: false` is passed.

## License

MIT
