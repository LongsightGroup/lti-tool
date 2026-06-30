import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

type PackageImportTarget =
  | string
  | {
      readonly source?: string;
    };

type PackageJson = {
  readonly imports?: Record<string, PackageImportTarget>;
};

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as PackageJson;

function sourceAliases(): Record<string, string> {
  return {
    '@longsightgroup/lti-tool': fileURLToPath(
      new URL('./packages/core/src/index.ts', import.meta.url),
    ),
    ...Object.fromEntries(
      Object.entries(packageJson.imports ?? {}).flatMap(([specifier, target]) => {
        if (typeof target === 'string' || target.source === undefined) return [];

        return [[specifier, fileURLToPath(new URL(target.source, import.meta.url))]];
      }),
    ),
  };
}

export default defineConfig({
  resolve: {
    alias: sourceAliases(),
  },
});
