import fs from 'fs';

const IS_WINDOWS = process.platform === 'win32';

/**
 * On Windows, when EPERM occurs during file removal, try chmod to 0o666
 * and retry. This handles read-only files and certain permission modes.
 */
export function fixWinEPERM(path: string, originalError: NodeJS.ErrnoException, callback: (err?: NodeJS.ErrnoException | null) => void): void {
  fs.chmod(path, 0o666, (chmodErr) => {
    if (chmodErr) {
      // chmod failed, return original error
      callback(originalError);
      return;
    }

    fs.stat(path, (statErr, stats) => {
      if (statErr) {
        // stat failed, return original error
        callback(originalError);
        return;
      }

      if (stats.isDirectory()) {
        fs.rmdir(path, callback);
      } else {
        fs.unlink(path, callback);
      }
    });
  });
}

/**
 * Sync version of fixWinEPERM.
 */
export function fixWinEPERMSync(path: string, originalError: NodeJS.ErrnoException): void {
  try {
    fs.chmodSync(path, 0o666);
  } catch (_chmodErr) {
    throw originalError;
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(path);
  } catch (_statErr) {
    throw originalError;
  }

  if (stats.isDirectory()) {
    fs.rmdirSync(path);
  } else {
    fs.unlinkSync(path);
  }
}

/**
 * Check if an error is EPERM on Windows and should be handled with chmod fix.
 */
export function shouldFixEPERM(err: NodeJS.ErrnoException): boolean {
  return IS_WINDOWS && err.code === 'EPERM';
}
