/**
 * Error for removing a directory without the recursive option.
 */
export function createEISDIR(path: string): NodeJS.ErrnoException {
  const err = new Error(`EISDIR: illegal operation on a directory, rm '${path}'`) as NodeJS.ErrnoException;
  err.code = 'EISDIR';
  err.syscall = 'rm';
  err.path = path;
  return err;
}
