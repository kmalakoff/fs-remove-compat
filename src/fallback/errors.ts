import os from 'os';
import type { FsPath } from '../lib/path.ts';

const EISDIR_ERRNO = typeof os.constants === 'object' ? os.constants.errno.EISDIR : 21;

/** Error for removing a directory without the recursive option. */
export function createEISDIR(path: FsPath): NodeJS.ErrnoException {
  const err = new Error(`Path is a directory: rm returned EISDIR (is a directory) ${path}`) as NodeJS.ErrnoException & { info: { code: string; message: string; path: FsPath; syscall: string; errno: number } };
  err.name = 'SystemError';
  err.code = 'ERR_FS_EISDIR';
  err.errno = EISDIR_ERRNO;
  err.syscall = 'rm';
  err.path = path.toString();
  err.info = { code: 'EISDIR', message: 'is a directory', path, syscall: 'rm', errno: err.errno };
  return err;
}
