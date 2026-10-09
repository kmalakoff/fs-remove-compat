import type { RmCallback, RmOptions } from '../types.ts';

const DEFAULTS: Required<RmOptions> = { recursive: false, force: false, maxRetries: 0, retryDelay: 100 };

export function invalidType(name: string, expected: string): NodeJS.ErrnoException {
  const error = new TypeError(`The "${name}" argument must be ${expected}.`) as NodeJS.ErrnoException;
  error.code = 'ERR_INVALID_ARG_TYPE';
  return error;
}

export function validateCallback(callback: RmCallback): void {
  if (typeof callback !== 'function') throw invalidType('callback', 'a function');
}

export function validateOptions(options?: RmOptions, defaults = DEFAULTS, allowArray = false): Required<RmOptions> {
  if (options !== undefined && (options === null || typeof options !== 'object' || (!allowArray && Array.isArray(options)))) {
    throw invalidType('options', 'an object');
  }
  const result = { ...defaults, ...options };
  const booleans = ['force', 'recursive'] as const;
  for (let i = 0; i < booleans.length; i++) {
    const name = booleans[i];
    if (typeof result[name] !== 'boolean') throw invalidType(`options.${name}`, 'a boolean');
  }
  const numbers = ['retryDelay', 'maxRetries'] as const;
  for (let i = 0; i < numbers.length; i++) {
    const name = numbers[i];
    const value = result[name];
    if (typeof value !== 'number') throw invalidType(`options.${name}`, 'a number');
    const max = name === 'retryDelay' ? 2147483647 : 4294967295;
    if (!(value >= 0 && value <= max && Math.floor(value) === value)) {
      const error = new RangeError(`The "options.${name}" argument must be an integer between 0 and ${max}.`) as NodeJS.ErrnoException;
      error.code = 'ERR_OUT_OF_RANGE';
      throw error;
    }
  }
  return result;
}

/** Native Node 14 accepts array objects as options; later native versions reject them. */
export function validateNativeOptions(options?: RmOptions): Required<RmOptions> {
  return validateOptions(options, DEFAULTS, parseInt(process.versions.node.split('.')[0], 10) === 14);
}
