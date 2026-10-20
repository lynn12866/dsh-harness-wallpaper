import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePackageFiles } from '../scripts/check-package.ts';

const runtimePackage = [
  'package.json',
  'README.md',
  'LICENSE',
  'cordis.patch.yml',
  'icon.svg',
  'locale/zh.json',
  'locale/en.json',
  'docs/images/settings.png',
  'dist/client.js',
  'dist/host/index.js',
  'dist/host/rpc.js',
  'dist/host/store.js',
  'dist/shared/constants.js',
  'dist/shared/types.js',
];

test('runtime package includes all required entry points and resources', () => {
  assert.doesNotThrow(() => validatePackageFiles(runtimePackage));
});

test('publishing rejects source, tests, development files and source maps', () => {
  for (const extra of [
    'src/client/plugin.tsx',
    'test/store.test.ts',
    'scripts/release.ts',
    'tsconfig.json',
    'dist/client.js.map',
    'dist/host/index.d.ts',
    'dist/shared/../../private.js',
  ]) {
    assert.throws(() => validatePackageFiles([...runtimePackage, extra]), /多余文件/);
  }
});

test('publishing rejects a package missing its client entry', () => {
  assert.throws(
    () => validatePackageFiles(runtimePackage.filter((path) => path !== 'dist/client.js')),
    /缺少文件.*dist\/client\.js/,
  );
});
