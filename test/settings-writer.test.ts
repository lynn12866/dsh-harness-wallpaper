import assert from 'node:assert/strict';
import test from 'node:test';
import type { WallpaperConfig } from '../src/shared/types.ts';
import { SettingsWriter } from '../src/client/settings-writer.ts';

type Patch = Partial<WallpaperConfig>;

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

test('rapid edits coalesce into one complete settings update', async (context) => {
  const writes: Patch[] = [];
  let saved = 0;
  const writer = new SettingsWriter(
    async (patch) => {
      writes.push(patch);
    },
    {
      saved: () => {
        saved += 1;
      },
      failed: () => assert.fail('Unexpected save failure'),
    },
  );
  context.after(() => writer.dispose());
  writer.stage({ opacity: 15 });
  writer.stage({ opacity: 75, blur: 4 });
  writer.stage({ dim: 10 });
  assert.equal(await writer.flush(), true);
  assert.deepEqual(writes, [{ opacity: 75, blur: 4, dim: 10 }]);
  assert.equal(saved, 1);
});

test('failed writes remain retryable and do not report a successful save', async (context) => {
  let offline = true;
  let failures = 0;
  let saved = 0;
  const writes: Patch[] = [];
  const writer = new SettingsWriter(
    async (patch) => {
      if (offline) {
        throw new Error('offline');
      }
      writes.push(patch);
    },
    {
      saved: () => {
        saved += 1;
      },
      failed: () => {
        failures += 1;
      },
    },
  );
  context.after(() => writer.dispose());
  writer.stage({ opacity: 33 });
  assert.equal(await writer.flush(), false);
  assert.equal(saved, 0);
  assert.equal(failures, 1);
  offline = false;
  assert.equal(await writer.flush(), true);
  assert.deepEqual(writes, [{ opacity: 33 }]);
  assert.equal(saved, 1);
});

test('a late failed response cannot retry an older value over a later edit', async (context) => {
  const started = deferred();
  const first = deferred();
  const writes: Patch[] = [];
  const writer = new SettingsWriter(
    async (patch) => {
      writes.push(patch);
      if (writes.length === 1) {
        started.resolve();
        await first.promise;
      }
    },
    { saved: () => undefined, failed: () => undefined },
  );
  context.after(() => writer.dispose());
  writer.stage({ opacity: 20 });
  const initialSave = writer.flush();
  await started.promise;
  writer.stage({ opacity: 80 });
  const laterSave = writer.flush();
  first.reject(new Error('delayed failure'));
  await Promise.all([initialSave, laterSave]);
  assert.equal(await writer.flush(), true);
  assert.deepEqual(writes, [{ opacity: 20 }, { opacity: 80 }]);
});

test('retry keeps a failed setting without replacing successful unrelated edits', async (context) => {
  const started = deferred();
  const first = deferred();
  const writes: Patch[] = [];
  const writer = new SettingsWriter(
    async (patch) => {
      writes.push(patch);
      if (writes.length === 1) {
        started.resolve();
        await first.promise;
      }
    },
    { saved: () => undefined, failed: () => undefined },
  );
  context.after(() => writer.dispose());
  writer.stage({ opacity: 20 });
  const initialSave = writer.flush();
  await started.promise;
  writer.stage({ dim: 40 });
  const laterSave = writer.flush();
  first.reject(new Error('delayed failure'));
  await Promise.all([initialSave, laterSave]);
  assert.equal(writer.hasPending(), true);
  assert.equal(await writer.flush(), true);
  assert.deepEqual(writes, [{ opacity: 20 }, { dim: 40 }, { opacity: 20 }]);
});
