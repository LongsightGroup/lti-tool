const SERVERLESS_ENV_KEYS = [
  'AWS_LAMBDA_FUNCTION_NAME',
  'AWS_EXECUTION_ENV',
  'LAMBDA_TASK_ROOT',
  'FUNCTION_NAME',
  'FUNCTION_TARGET',
  'K_SERVICE',
  'FUNCTIONS_WORKER_RUNTIME',
  'AZURE_FUNCTIONS_ENVIRONMENT',
  'VERCEL',
  'NETLIFY',
] as const;

/**
 * Detects whether the application is running in a known serverless environment.
 *
 * The package is not Node-only, so this checks for an optional `process.env`
 * object at runtime without depending on Node ambient types. Runtimes such as
 * Cloudflare Workers that do not expose `process` simply return false.
 */
export function isServerlessEnvironment(): boolean {
  const env = getRuntimeProcessEnv();
  if (env === undefined) return false;

  return SERVERLESS_ENV_KEYS.some((key) => hasEnvValue(env, key));
}

function getRuntimeProcessEnv(): object | undefined {
  const processValue: unknown = Reflect.get(globalThis, 'process');
  if (!isObject(processValue)) return undefined;

  const envValue: unknown = Reflect.get(processValue, 'env');
  return isObject(envValue) ? envValue : undefined;
}

function hasEnvValue(env: object, key: string): boolean {
  const value: unknown = Reflect.get(env, key);
  return typeof value === 'string' && value.length > 0;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
