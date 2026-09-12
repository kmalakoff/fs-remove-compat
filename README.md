# fs-remove-compat

Cross-platform file removal utilities with Node.js 0.8+ compatibility. The strict `rm` and `rmSync` functions match the Node.js `fs.rm` APIs. The `safeRm` and `safeRmSync` variants use Windows-friendly defaults for cleanup tasks.

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

The asynchronous functions use Node-style callbacks. They do not return Promises. Use `safeRm` or `safeRmSync` for cleanup where Windows file locking is common. The package uses native `fs.rm` on Node 14.14 and newer and a fallback on older versions.

## License

MIT
