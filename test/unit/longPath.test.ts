import assert from 'assert';
import { rm, rmSync, safeRm, safeRmSync } from 'fs-remove-compat';
import path from 'path';

import { toBuffer } from '../../src/lib/path.ts';
import { buildLongTree, LONG_PATH_FILE_LENGTH, leafEntries, longTreeExists, removeLongTree } from '../lib/longPath.ts';
import { TMP_DIR } from '../lib/scratch.ts';

const IS_WIN32 = process.platform === 'win32';

type Input = { label: string; make: (root: string) => string | Buffer };
const INPUTS: Input[] = [
  { label: 'string', make: (root) => root },
  { label: 'Buffer', make: (root) => toBuffer(root) },
  { label: 'relative Buffer', make: (root) => toBuffer(path.relative(process.cwd(), root)) },
  { label: 'namespaced Buffer', make: (root) => toBuffer(`\\\\?\\${root}`) },
];

// A tree whose file paths exceed MAX_PATH is a Windows property; other platforms have no such limit to exercise.
(IS_WIN32 ? describe : describe.skip)('removal of paths longer than MAX_PATH (win32)', () => {
  const roots: string[] = [];
  after(() => {
    const errors: Error[] = [];
    roots.forEach((root) => {
      try {
        if (longTreeExists(root)) removeLongTree(root);
      } catch (error) {
        errors.push(error as Error);
      }
    });
    if (errors.length) throw new Error(`${errors.length} fixture cleanup failures: ${errors.map((error) => error.message).join('; ')}`);
  });

  function fixture(name: string): { root: string; leaf: string } {
    roots.push(path.join(TMP_DIR, name)); // registered first so a partly built tree is still cleaned up
    const tree = buildLongTree(name);
    assert.ok(path.join(tree.leaf, 'package.json').length >= LONG_PATH_FILE_LENGTH);
    assert.deepEqual(leafEntries(tree.leaf), ['index.js', 'package.json']);
    return tree;
  }

  function assertRemoved(root: string): void {
    assert.ok(!longTreeExists(root), 'tree should be removed');
  }

  INPUTS.forEach((input) => {
    const slug = input.label.replace(/ /g, '-');
    const options = { recursive: true, force: true };

    it(`safeRm removes a ${input.label} root`, (done) => {
      const { root } = fixture(`long-safeRm-${slug}`);
      safeRm(input.make(root), (err) => {
        if (err) return done(err);
        assertRemoved(root);
        done();
      });
    });

    it(`safeRmSync removes a ${input.label} root`, () => {
      const { root } = fixture(`long-safeRmSync-${slug}`);
      safeRmSync(input.make(root));
      assertRemoved(root);
    });

    it(`rm removes a ${input.label} root`, (done) => {
      const { root } = fixture(`long-rm-${slug}`);
      rm(input.make(root), options, (err) => {
        if (err) return done(err);
        assertRemoved(root);
        done();
      });
    });

    it(`rmSync removes a ${input.label} root`, () => {
      const { root } = fixture(`long-rmSync-${slug}`);
      rmSync(input.make(root), options);
      assertRemoved(root);
    });
  });
});
