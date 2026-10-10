import fs from 'fs';
import mkdirp from 'mkdirp-classic';
import path from 'path';
import { TMP_DIR } from './scratch.ts';

// Trees deeper than MAX_PATH can only be built and inspected through \\?\ string paths. These helpers
// never use the code under test, so a failing removal is reported against an intact, verified fixture.
const ns = (value: string): string => `\\\\?\\${value}`;

export const LONG_PATH_FILE_LENGTH = 265;

export function buildLongTree(name: string): { root: string; leaf: string } {
  mkdirp.sync(TMP_DIR);
  const root = path.join(TMP_DIR, name);
  fs.mkdirSync(ns(root));
  let leaf = root;
  let depth = 0;
  while (path.join(leaf, 'package.json').length < LONG_PATH_FILE_LENGTH) {
    const modules = path.join(leaf, 'node_modules');
    fs.mkdirSync(ns(modules));
    leaf = path.join(modules, `pkg-${depth++}`);
    fs.mkdirSync(ns(leaf));
  }
  fs.writeFileSync(ns(path.join(leaf, 'package.json')), '{}');
  fs.writeFileSync(ns(path.join(leaf, 'index.js')), '');
  return { root, leaf };
}

export function longTreeExists(target: string): boolean {
  try {
    fs.lstatSync(ns(target));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function leafEntries(leaf: string): string[] {
  return fs.readdirSync(ns(leaf)).sort();
}

export function removeLongTree(target: string): void {
  const full = ns(target);
  if (fs.lstatSync(full).isDirectory()) {
    fs.readdirSync(full).forEach((entry) => {
      removeLongTree(`${target}\\${entry}`);
    });
    fs.rmdirSync(full);
  } else fs.unlinkSync(full);
}
