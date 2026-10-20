import test from 'node:test';
import type { TestContext } from 'node:test';
import type { FetchRoute } from '../src/host/contracts.ts';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WallpaperStore, sniff } from '../src/host/store.ts';
import { CHUNK_BYTES, MAX_BYTES, DEFAULTS, NAMESPACE } from '../src/shared/constants.ts';
import { createRoute } from '../src/host/rpc.ts';
import { apply } from '../src/host/index.ts';

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-harness-wallpaper-test-'));
  const store = new WallpaperStore(directory);
  await store.ready;
  t.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, store };
}
async function upload(store: WallpaperStore, bytes: Buffer = gif, name = '动画.gif') {
  const { id } = await store.begin({ name, bytes: bytes.length });
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    await store.chunk({
      id,
      offset,
      data: bytes.subarray(offset, offset + CHUNK_BYTES).toString('base64'),
    });
  }
  return { id, snapshot: await store.finish({ id }) };
}

test('settings and original animated media survive a new process/store instance', async (t) => {
  const { store, directory } = await fixture(t);
  const { id } = await upload(store);
  await store.set({
    opacity: 25,
    transparency: 90,
    dim: 5,
    blur: 3,
    fit: 'contain',
    playing: false,
  });
  const reopened = new WallpaperStore(directory);
  t.after(() => reopened.close());
  const saved = await reopened.get();
  assert.equal(saved.config.selected, id);
  assert.equal(saved.config.opacity, 25);
  assert.equal(saved.config.transparency, 90);
  assert.equal(saved.config.playing, false);
  assert.equal(saved.assets.at(0)?.mime, 'image/gif');
  assert.deepEqual(Buffer.from((await reopened.read({ id, offset: 0 })).data, 'base64'), gif);
});

test('multi-chunk video transfers preserve bytes and support offset reads', async (t) => {
  const { store } = await fixture(t);
  const video = Buffer.alloc(CHUNK_BYTES * 2 + 19, 83);
  video.write('ftypisom', 4, 'ascii');
  const { id, snapshot } = await upload(store, video, 'video.mp4');
  assert.equal(snapshot.assets.at(0)?.kind, 'video');
  const chunks = [];
  for (let offset = 0; offset < video.length; offset += CHUNK_BYTES) {
    chunks.push(Buffer.from((await store.read({ id, offset })).data, 'base64'));
  }
  assert.deepEqual(Buffer.concat(chunks), video);
});

test('content sniffing preserves supported formats and rejects executable SVG', () => {
  assert.equal(sniff(gif).mime, 'image/gif');
  assert.equal(sniff(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])).mime, 'image/png');
  assert.equal(sniff(Buffer.from([255, 216, 255, 224])).mime, 'image/jpeg');
  assert.equal(sniff(Buffer.from('RIFF0000WEBP')).mime, 'image/webp');
  assert.equal(sniff(Buffer.from('0000ftypavif0000')).mime, 'image/avif');
  assert.equal(
    sniff(Buffer.concat([Buffer.from([26, 69, 223, 163]), Buffer.from('webm')])).mime,
    'video/webm',
  );
  assert.throws(() => sniff(Buffer.from('<svg onload="alert(1)">')), /不支持/);
  assert.throws(() => sniff(Buffer.from('0000ftypheic0000')), /不支持/);
});

test('incomplete, out-of-order and oversized uploads never become active', async (t) => {
  const { store } = await fixture(t);
  const { id } = await store.begin({ name: 'a.gif', bytes: gif.length });
  await assert.rejects(store.chunk({ id, offset: 10, data: gif.toString('base64') }), /顺序/);
  await assert.rejects(store.finish({ id }), /完整/);
  await assert.rejects(store.begin({ name: 'empty', bytes: 0 }), /100 MiB/);
  await assert.rejects(store.begin({ name: 'big', bytes: MAX_BYTES + 1 }), /100 MiB/);
  await assert.rejects(store.chunk({ id, offset: 0, data: '!@#$' }), /格式/);
  assert.equal((await store.get()).assets.length, 0);
  await store.cancel({ id });
});

test('renaming HTML to GIF is rejected and partial data is deleted', async (t) => {
  const { store, directory } = await fixture(t);
  await assert.rejects(upload(store, Buffer.from('<html>bad</html>'), 'fake.gif'), /不支持/);
  assert.equal((await store.get()).assets.length, 0);
  assert.deepEqual(await readdir(directory), []);
});

test('delete active wallpaper restores base theme; settings persist independently', async (t) => {
  const { store, directory } = await fixture(t);
  const { id } = await upload(store);
  await store.set({ transparency: 45 });
  const saved = await store.remove({ id });
  assert.equal(saved.config.enabled, false);
  assert.equal(saved.config.transparency, 45);
  assert.equal(saved.assets.length, 0);
  assert.deepEqual(await readdir(directory), ['library.json']);
  await assert.rejects(store.read({ id, offset: 0 }), /不存在/);
});

test('settings input and file paths are bounded at host boundary', async (t) => {
  const { store } = await fixture(t);
  for (const patch of [
    { opacity: -1 },
    { transparency: 101 },
    { blur: 31 },
    { dim: '50' },
    { playing: 1 },
    { selected: '../../secret' },
    { fit: 'execute' },
    { bad: true },
  ]) {
    await assert.rejects(store.set(patch));
  }
  await assert.rejects(store.cancel({ id: '../../secret' }), /标识/);
  await assert.rejects(store.read({ id: '../../secret', offset: 0 }), /不存在/);
  assert.deepEqual((await store.get()).config, DEFAULTS);
});

test('concurrent settings updates retain each change and snapshots cannot mutate store', async (t) => {
  const { store, directory } = await fixture(t);
  await Promise.all([store.set({ opacity: 20 }), store.set({ dim: 40 }), store.set({ blur: 10 })]);
  const snapshot = await store.get();
  assert.equal(snapshot.config.opacity, 20);
  assert.equal(snapshot.config.dim, 40);
  assert.equal(snapshot.config.blur, 10);
  snapshot.config.opacity = 0;
  assert.equal((await store.get()).config.opacity, 20);
  assert.equal(JSON.parse(await readFile(join(directory, 'library.json'), 'utf8')).config.blur, 10);
});

test('boot removes only orphaned media and incomplete upload artifacts', async (t) => {
  const { store, directory } = await fixture(t);
  const { id } = await upload(store);
  await writeFile(join(directory, '11111111-1111-1111-1111-111111111111.part'), 'partial');
  await writeFile(join(directory, '22222222-2222-2222-2222-222222222222'), 'orphan');
  await writeFile(join(directory, 'keep.txt'), 'retain');
  const reopened = new WallpaperStore(directory);
  t.after(() => reopened.close());
  await reopened.ready;
  assert.deepEqual((await readdir(directory)).sort(), [id, 'keep.txt', 'library.json'].sort());
});

test('corrupt metadata raises an actionable error without overwriting user files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-harness-wallpaper-corrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'library.json'), '{broken');
  const store = new WallpaperStore(directory);
  await assert.rejects(store.get());
  await store.close();
  assert.equal(await readFile(join(directory, 'library.json'), 'utf8'), '{broken');
});

test('RPC envelopes validate method, JSON type and body size', async () => {
  const route = createRoute('get', async () => ({ ok: 'value' }));
  const request = (value: unknown, type = 'application/json') =>
    new Request('http://localhost/api/dsh-harness-wallpaper/get', {
      method: 'POST',
      headers: { 'content-type': type },
      body: typeof value === 'string' ? value : JSON.stringify(value),
    });
  assert.equal((await route.fetch(request('x', 'text/plain'))).status, 415);
  assert.equal((await route.fetch(request('no-json'))).status, 400);
  assert.equal((await route.fetch(request(' '.repeat(740000)))).status, 413);
  assert.equal(
    (
      await route.fetch(
        request({ type: 'client-request', rpcId: '1', method: 'wrong', payload: {} }),
      )
    ).status,
    400,
  );
  const result = await route.fetch(
    request({
      type: 'client-request',
      rpcId: '1',
      method: 'dsh-harness-wallpaper/get',
      payload: {},
    }),
  );
  assert.deepEqual(await result.json(), {
    type: 'server-response',
    rpcId: '1',
    result: { ok: true, value: { ok: 'value' } },
  });
  const failure = createRoute('get', async () => {
    throw new Error('expected');
  });
  assert.equal(
    (
      await (
        await failure.fetch(
          request({
            type: 'client-request',
            rpcId: '2',
            method: 'dsh-harness-wallpaper/get',
            payload: {},
          }),
        )
      ).json()
    ).result.error.message,
    'expected',
  );
});

test('host registers eight carrier-neutral routes and disposes all resources', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-harness-wallpaper-host-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const routes = new Map<string, FetchRoute>();
  const effects: (() => void | Promise<void>)[] = [];
  await apply({
    profileContext: { dir: directory },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route);
          return () => routes.delete(route.path);
        },
      },
    },
    effect(setup) {
      const dispose = setup();
      if (dispose) {
        effects.push(dispose);
      }
    },
  });
  assert.equal(routes.size, 8);
  const endpoint = `/api/${NAMESPACE}/set`;
  const settingsRoute = routes.get(endpoint);
  assert.ok(settingsRoute);
  const response = await settingsRoute.fetch(
    new Request(`http://localhost${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'host-settings',
        method: `${NAMESPACE}/set`,
        payload: { opacity: 69 },
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.value.config.opacity, 69);
  const saved = JSON.parse(await readFile(join(directory, NAMESPACE, 'library.json'), 'utf8'));
  assert.equal(saved.config.opacity, 69);
  for (const dispose of effects.reverse()) {
    await dispose?.();
  }
  assert.equal(routes.size, 0);
});
