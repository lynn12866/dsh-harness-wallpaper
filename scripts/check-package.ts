import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../src/shared/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const requiredFiles = [
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
  'dist/host/tools.js',
  'dist/shared/constants.js',
  'dist/shared/types.js',
];

export function validatePackageFiles(paths: readonly string[]): void {
  const unexpected = paths.filter(
    (path) => !requiredFiles.includes(path) && !/^dist\/(?:host|shared)\/[^/]+\.js$/.test(path),
  );
  const missing = requiredFiles.filter((path) => !paths.includes(path));
  if (unexpected.length || missing.length) {
    throw new Error(
      `发布包内容不符合要求。多余文件：${unexpected.join(', ') || '无'}；缺少文件：${missing.join(', ') || '无'}。`,
    );
  }
}

function checkPackage(): void {
  const args = ['pack', '--dry-run', '--json', '--ignore-scripts'];
  // Fixed arguments only. Ignoring lifecycle scripts prevents prepack recursion.
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const commandArgs =
    process.platform === 'win32' ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args;
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || '无法读取 npm 打包清单。');
  }
  const packages: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(packages) || packages.length !== 1) {
    throw new Error('npm 打包清单格式不正确。');
  }
  const entry: unknown = packages[0];
  if (!isRecord(entry) || !Array.isArray(entry.files)) {
    throw new Error('npm 打包清单缺少文件信息。');
  }
  const paths = entry.files.map((file: unknown) => {
    if (!isRecord(file) || typeof file.path !== 'string') {
      throw new Error('npm 打包清单含无效文件路径。');
    }
    return file.path;
  });
  validatePackageFiles(paths);
  console.log(`发布包检查通过：${paths.length} 个文件。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkPackage();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
