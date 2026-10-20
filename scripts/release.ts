import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org/';
const root = fileURLToPath(new URL('../', import.meta.url));
type NpmCommand = (args: readonly string[]) => void;

function executeNpm(args: readonly string[]): void {
  // Only our fixed argument lists reach cmd.exe; user-supplied arguments are rejected.
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const commandArgs =
    process.platform === 'win32' ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : [...args];
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm ${args[0]} 失败（${result.status ?? result.signal}）。`);
  }
}

export function release(args: readonly string[], run: NpmCommand = executeNpm): void {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run')) {
    throw new Error('用法：pnpm release [--dry-run]');
  }
  if (args[0] === '--dry-run') {
    // pack runs the same prepack checks/build without logging in or publishing.
    run(['pack', '--dry-run', '--ignore-scripts=false']);
    return;
  }
  run(['login', '--auth-type=web', `--registry=${registry}`]);
  run(['whoami', `--registry=${registry}`]);
  // prepack executes pnpm check; failed checks abort the upload.
  run(['publish', `--registry=${registry}`, '--access=public', '--ignore-scripts=false']);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).join(' ') === '--help') {
    console.log('pnpm release            登录 npm，校验、构建并发布当前版本。');
    console.log('pnpm release --dry-run  仅校验、构建并预览安装包，不登录、不发布。');
  } else {
    try {
      release(process.argv.slice(2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
