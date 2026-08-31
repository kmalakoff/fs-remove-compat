const assert = require('assert');
const { rm, rmSync, safeRm, safeRmSync } = require('fs-remove-compat');

describe('exports .cjs', () => {
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
