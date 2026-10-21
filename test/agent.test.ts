import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mountHost } from './helpers/host.ts';
import { NAMESPACE, MAX_BYTES } from '../src/shared/constants.ts';

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-wallpaper-agent-'));
  const host = await mountHost(directory);
  t.after(async () => {
    await host.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  const controller = new AbortController();
  const exec = { signal: controller.signal, agent: { session: {} } };
  async function invoke(name: string, args: unknown) {
    const tool = host.tools.get(name);
    assert.ok(tool);
    return await tool.execute(args, exec);
  }
  return { ...host, directory, invoke, controller, exec };
}

test('Agent imports original media, switches by list id, adjusts parameters and preserves source', async (t) => {
  const { directory, invoke, call } = await fixture(t);
  await writeFile(join(directory, '测试.gif'), gif);
  await invoke('wallpaper_import', { path: '测试.gif' });
  const imported = await call('get', {});
  const asset = imported.assets[0];
  assert.ok(asset);
  assert.equal(asset.kind, 'image');
  assert.deepEqual(await readFile(join(directory, NAMESPACE, asset.id)), gif);
  assert.deepEqual(await readFile(join(directory, '测试.gif')), gif);
  await invoke('wallpaper_set', {
    opacity: 42,
    transparency: 61,
    dim: 12,
    blur: 8,
    playing: false,
  });
  await invoke('wallpaper_switch', { id: 'ocean' });
  assert.equal((await call('get', {})).config.selected, 'ocean');
  await invoke('wallpaper_switch', { id: asset.id });
  const snapshot = await call('get', {});
  assert.equal(snapshot.config.selected, asset.id);
  assert.equal(snapshot.config.enabled, true);
  assert.equal(snapshot.config.opacity, 42);
  assert.equal(snapshot.config.transparency, 61);
  assert.equal(snapshot.config.blur, 8);
  assert.equal(snapshot.config.playing, false);
  const listing = JSON.stringify(await invoke('wallpaper_list', {}));
  assert.match(listing, /测试.gif/);
  assert.doesNotMatch(listing, /R0lGODlh/);
});

test('tool validation rejects unknown fields, invalid ranges, empty changes and missing ids', async (t) => {
  const { invoke, call } = await fixture(t);
  const before = await call('get', {});
  for (const [name, args] of [
    ['wallpaper_set', {}],
    ['wallpaper_set', { opacity: 101 }],
    ['wallpaper_set', { blur: -1 }],
    ['wallpaper_set', { enabled: 'yes' }],
    ['wallpaper_set', { command: 'run' }],
    ['wallpaper_switch', {}],
    ['wallpaper_switch', { id: '../../private' }],
    ['wallpaper_list', { path: '/private' }],
  ] as const) {
    await assert.rejects(invoke(name, args));
  }
  assert.deepEqual((await call('get', {})).config, before.config);
});

test('import rejects unsupported, oversized and unreadable files without partial media', async (t) => {
  const { ctx, directory, invoke, call } = await fixture(t);
  await writeFile(join(directory, 'fake.gif'), '<html>not an image</html>');
  await assert.rejects(invoke('wallpaper_import', { path: 'fake.gif' }), /不支持/);
  await assert.rejects(invoke('wallpaper_import', { path: directory }), /普通文件/);
  const originalStat = ctx.fs.stat;
  ctx.fs.stat = async () => ({ type: 'file', size: MAX_BYTES + 1, version: 'large' });
  await assert.rejects(invoke('wallpaper_import', { path: 'fake.gif' }), /100 MiB/);
  ctx.fs.stat = originalStat;
  ctx.fs.resolve = async () => {
    throw new Error('FS_PERMISSION_DENIED');
  };
  await assert.rejects(invoke('wallpaper_import', { path: 'private.gif' }), /FS_PERMISSION_DENIED/);
  assert.equal((await call('get', {})).assets.length, 0);
  assert.deepEqual(await readdir(join(directory, NAMESPACE)), []);
});

test('source changes and cancellation during import clean partial uploads and keep current settings', async (t) => {
  const { ctx, directory, invoke, call, controller } = await fixture(t);
  await writeFile(join(directory, 'animation.gif'), gif);
  const originalStat = ctx.fs.stat;
  let stats = 0;
  ctx.fs.stat = async (target, signal) => {
    const info = await originalStat(target, signal);
    return info && { ...info, version: String(++stats) };
  };
  await assert.rejects(invoke('wallpaper_import', { path: 'animation.gif' }), /发生变化/);
  ctx.fs.stat = originalStat;
  const originalRead = ctx.fs.readByteRange;
  let reads = 0;
  ctx.fs.readByteRange = async (target, range, signal) => {
    const bytes = await originalRead(target, range, signal);
    if (++reads === 2) {
      controller.abort(new Error('cancelled'));
    }
    return bytes;
  };
  await assert.rejects(invoke('wallpaper_import', { path: 'animation.gif' }), /cancelled/);
  assert.equal((await call('get', {})).assets.length, 0);
  assert.deepEqual(await readdir(join(directory, NAMESPACE)), []);
});

test('changes release all waiting windows immediately; aborted requests do not retain watchers', async (t) => {
  const { call, invoke } = await fixture(t);
  const before = await call('get', {});
  const first = call('watch', { revision: before.revision });
  const second = call('watch', { revision: before.revision });
  await invoke('wallpaper_set', { opacity: 33 });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.config.opacity, 33);
  assert.equal(a.revision, b.revision);
  assert.notEqual(a.revision, before.revision);
  for (let i = 0; i < 70; i += 1) {
    const controller = new AbortController();
    const watching = call('watch', { revision: a.revision }, controller.signal);
    controller.abort(new Error('cancelled watch'));
    await assert.rejects(watching);
  }
  const last = call('watch', { revision: a.revision });
  await invoke('wallpaper_switch', { id: 'night' });
  assert.equal((await last).config.selected, 'night');
});
