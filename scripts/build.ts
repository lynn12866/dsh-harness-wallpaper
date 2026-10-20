import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { PACKAGE_NAME } from '../src/shared/constants.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));

await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
execFileSync(process.execPath, [compiler, '--project', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit',
});

await build({
  absWorkingDir: root,
  entryPoints: ['src/client/plugin.tsx'],
  outfile: 'dist/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'transform',
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
  loader: { '.css': 'text' },
  minify: false,
  sourcemap: 'external',
  legalComments: 'none',
  banner: {
    js: `window.__ModuleLoader__.load({
  id: ${JSON.stringify(PACKAGE_NAME)},
  factory(require) {
    const module = { exports: {} };
    const exports = module.exports;`,
  },
  footer: { js: '    return module.exports;\n  }\n});' },
});
