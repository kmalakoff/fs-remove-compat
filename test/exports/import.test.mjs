import assert from 'assert';
import { rm, rmSync, safeRm, safeRmSync } from 'fs-remove-compat';

describe('exports .mjs', () => {
  it('rm', () => {
    assert.equal(typeof rm, 'function');
  });
  it('rmSync', () => {
    assert.equal(typeof rmSync, 'function');
  });
  it('safeRm', () => {
    assert.equal(typeof safeRm, 'function');
  });
  it('safeRmSync', () => {
    assert.equal(typeof safeRmSync, 'function');
  });
});
