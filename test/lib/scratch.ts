import fs from 'fs';
import type { RmOptions } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';
import url from 'url';

const ___filename = typeof __filename !== 'undefined' ? __filename : url.fileURLToPath(import.meta.url);
const ___dirname = path.dirname(___filename);

export const TMP_DIR = path.join(___dirname, '..', '..', '.tmp');

type SafeRmSync = (path: string, options?: RmOptions) => void;

export function createScratch(safeRmSync: SafeRmSync): { setupTmp: () => void; cleanTmp: () => void } {
  function cleanTmp(): void {
    if (pathExists()) {
      safeRmSync(TMP_DIR, { recursive: true, force: true });
    }
  }

  function setupTmp(): void {
    cleanTmp();
    mkdirp.sync(TMP_DIR);
  }

  return { setupTmp, cleanTmp };
}

function pathExists(): boolean {
  return fs.existsSync(TMP_DIR);
}
