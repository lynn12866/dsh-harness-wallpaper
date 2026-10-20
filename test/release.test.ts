import assert from 'node:assert/strict';
import { test } from 'node:test';
import { release } from '../scripts/release.ts';

test('publication requires npm login and a verified identity', () => {
  const commands: string[][] = [];
  release([], (args) => commands.push([...args]));
  assert.deepEqual(commands, [
    ['login', '--auth-type=web', '--registry=https://registry.npmjs.org/'],
    ['whoami', '--registry=https://registry.npmjs.org/'],
    [
      'publish',
      '--registry=https://registry.npmjs.org/',
      '--access=public',
      '--ignore-scripts=false',
    ],
  ]);
});

for (const failure of ['login', 'whoami']) {
  test(`failed ${failure} never publishes`, () => {
    const commands: string[] = [];
    assert.throws(
      () =>
        release([], (args) => {
          commands.push(args[0]!);
          if (args[0] === failure) {
            throw new Error('Authentication failed');
          }
        }),
      /Authentication failed/,
    );
    assert.equal(commands.includes('publish'), false);
  });
}

test('dry run checks and previews without authentication or publication', () => {
  const commands: string[][] = [];
  release(['--dry-run'], (args) => commands.push([...args]));
  assert.deepEqual(commands, [['pack', '--dry-run', '--ignore-scripts=false']]);
});

test('unrecognized release arguments cannot reach a shell', () => {
  for (const args of [['--registry=other'], ['--dry-run', '--access=private'], [';whoami']]) {
    let invoked = false;
    assert.throws(
      () =>
        release(args, () => {
          invoked = true;
        }),
      /用法/,
    );
    assert.equal(invoked, false);
  }
});
