import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { WallpaperController } from '../src/client/controller.ts';
import { WallpaperSync } from '../src/client/sync.ts';
import { mountHost } from './helpers/host.ts';

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) {
      return;
    }
    await delay(20);
  }
  assert.fail('Timed out waiting for live synchronization');
}

test('Agent changes reach two active windows without reload and preserve pending slider edits', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-wallpaper-sync-'));
  const host = await mountHost(directory);
  const controllers = [0, 1].map(
    () =>
      new WallpaperController(host.call, {
        render() {},
        dispose() {},
      }),
  );
  const syncs = controllers.map(
    (controller) =>
      new WallpaperSync(
        host.call,
        (snapshot) => controller.synchronize(snapshot),
        (error) => assert.fail(String(error)),
      ),
  );
  t.after(async () => {
    syncs.forEach((sync) => sync.stop());
    controllers.forEach((controller) => controller.dispose());
    await host.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  syncs.forEach((sync) => sync.start());
  await until(() => controllers.every((controller) => controller.getSnapshot().ready));
  const tool = host.tools.get('wallpaper_set');
  assert.ok(tool);
  await tool.execute(
    { selected: 'night', opacity: 36, playing: false },
    { signal: new AbortController().signal },
  );
  await until(() =>
    controllers.every((controller) => controller.getSnapshot().config?.selected === 'night'),
  );
  assert.ok(controllers.every((controller) => controller.getSnapshot().config?.opacity === 36));
  const first = controllers[0];
  assert.ok(first);
  first.update({ blur: 11 });
  await tool.execute({ dim: 43 }, { signal: new AbortController().signal });
  await until(() =>
    controllers.every((controller) => {
      const config = controller.getSnapshot().config;
      return config?.dim === 43 && config.blur === 11;
    }),
  );
  const durable = await host.call('get', {});
  assert.equal(durable.config.dim, 43);
  assert.equal(durable.config.blur, 11);
  syncs.forEach((sync) => sync.start());
  await tool.execute({ transparency: 55 }, { signal: new AbortController().signal });
  await until(() =>
    controllers.every((controller) => controller.getSnapshot().config?.transparency === 55),
  );
});
