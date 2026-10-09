import assert from 'assert';
import fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import path from 'path';
import url from 'url';
import { fileURLToPath } from '../../../src/lib/fileURLToPath.ts';
import { isWindows } from '../../lib/platform.ts';
import { errorCode } from '../../lib/removal.ts';
import { createScratch, TMP_DIR } from '../../lib/scratch.ts';

const { setupTmp, cleanTmp } = createScratch(safeRmSync);

// Native URL filesystem support starts at Node 7.6; Node 8/10 exercise the backport in the engines run.
const version = process.versions.node.split('.').map(Number);
if (typeof url.URL === 'function' && (version[0] >= 8 || (version[0] === 7 && version[1] >= 6))) {
  describe('fileURLToPath', () => {
    beforeEach(setupTmp);
    after(cleanTmp);

    it('decodes a real file URL using native filesystem semantics', () => {
      const file = path.join(TMP_DIR, 'space # percent % unicode é.txt');
      fs.writeFileSync(file, 'contents');
      const pathname = file
        .replace(/\\/g, '/')
        .split('/')
        .map((part, index) => (index === 0 || (isWindows && index === 0) ? part : encodeURIComponent(part)))
        .join('/');
      const value = new url.URL(`file://${isWindows ? '/' : ''}${pathname}`);
      assert.equal(fs.readFileSync(value, 'utf8'), 'contents');
      assert.equal(fs.readFileSync(fileURLToPath(value), 'utf8'), 'contents');
      if (typeof url.fileURLToPath === 'function') assert.equal(fileURLToPath(value), url.fileURLToPath(value));
    });

    for (const [href, code] of [
      ['https://example.com/file', 'ERR_INVALID_URL_SCHEME'],
      ['file:///tmp/encoded%2Fseparator', 'ERR_INVALID_FILE_URL_PATH'],
    ]) {
      it(`rejects ${href} like native filesystem operations`, () => {
        const value = new url.URL(href);
        assert.equal(
          errorCode(() => fileURLToPath(value)),
          code
        );
        assert.equal(
          errorCode(() => fs.lstatSync(value)),
          code
        );
        if (typeof url.fileURLToPath === 'function')
          assert.equal(
            errorCode(() => fileURLToPath(value)),
            errorCode(() => url.fileURLToPath(value))
          );
      });
    }

    if (isWindows) {
      it('decodes Windows drive and UNC paths and rejects encoded backslashes', () => {
        assert.equal(fileURLToPath(new url.URL('file:///C:/folder/file')), 'C:\\folder\\file');
        assert.equal(fileURLToPath(new url.URL('file://server/share/file')), '\\\\server\\share\\file');
        assert.equal(
          errorCode(() => fileURLToPath(new url.URL('file:///C:/bad%5Cpath'))),
          'ERR_INVALID_FILE_URL_PATH'
        );
        assert.equal(
          errorCode(() => fileURLToPath(new url.URL('file:///no-drive'))),
          'ERR_INVALID_FILE_URL_PATH'
        );
      });
    } else {
      it('rejects a remote hostname on POSIX like native filesystem operations', () => {
        const value = new url.URL('file://server/share/file');
        assert.equal(
          errorCode(() => fileURLToPath(value)),
          'ERR_INVALID_FILE_URL_HOST'
        );
        assert.equal(
          errorCode(() => fs.lstatSync(value)),
          'ERR_INVALID_FILE_URL_HOST'
        );
      });
    }
  });
}
