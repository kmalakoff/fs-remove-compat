import assert from 'assert';
import fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';

import { createScratch, TMP_DIR } from '../lib/scratch.ts';

const { setupTmp, cleanTmp } = createScratch(safeRmSync);

describe('safeRmSync', () => {
  beforeEach(setupTmp);
  after(cleanTmp);
  it('should remove a file', () => {
    const filePath = path.join(TMP_DIR, 'safe-file.txt');
    fs.writeFileSync(filePath, 'content');
    safeRmSync(filePath);
    assert.ok(!fs.existsSync(filePath), 'file should not exist after removal');
  });
  it('should remove directory recursively', () => {
    const dirPath = path.join(TMP_DIR, 'safe-recursive');
    mkdirp.sync(path.join(dirPath, 'subdir'));
    fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');
    safeRmSync(dirPath, { recursive: true });
    assert.ok(!fs.existsSync(dirPath), 'dir should not exist after removal');
  });
  it('should handle force option', () => {
    // Should not throw
    safeRmSync(path.join(TMP_DIR, 'nonexistent-safe.txt'), { force: true });
  });
});
