import { afterEach, describe, expect, it } from 'vitest';

import { isServerlessEnvironment } from '../src/utils/environment.js';

const originalProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');

afterEach(() => {
  if (originalProcessDescriptor === undefined) {
    Reflect.deleteProperty(globalThis, 'process');
    return;
  }

  Object.defineProperty(globalThis, 'process', originalProcessDescriptor);
});

describe('isServerlessEnvironment', () => {
  it('returns false when process is absent', () => {
    Reflect.deleteProperty(globalThis, 'process');

    expect(isServerlessEnvironment()).toBe(false);
  });

  it('detects known serverless environment variables', () => {
    setRuntimeProcess({ env: { AWS_LAMBDA_FUNCTION_NAME: 'lti-tool' } });

    expect(isServerlessEnvironment()).toBe(true);
  });

  it('ignores missing and empty environment variables', () => {
    setRuntimeProcess({ env: { AWS_LAMBDA_FUNCTION_NAME: '' } });

    expect(isServerlessEnvironment()).toBe(false);
  });
});

function setRuntimeProcess(processValue: unknown): void {
  Object.defineProperty(globalThis, 'process', {
    configurable: true,
    value: processValue,
  });
}
