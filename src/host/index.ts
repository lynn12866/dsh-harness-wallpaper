import { join } from 'node:path';
import { NAMESPACE } from '../shared/constants.ts';
import type { HostContext } from './contracts.ts';
import { createRoute } from './rpc.ts';
import { WallpaperStore } from './store.ts';

export const name = NAMESPACE;
export const inject = ['connection', 'profileContext'];

export async function apply(ctx: HostContext): Promise<void> {
  if (!ctx.connection.fetch?.register || !ctx.profileContext?.dir) {
    throw new Error('动态壁纸需要 DeepSeek Harness 0.2.1-rc.2 的 Connection Fetch 接口。');
  }

  const store = new WallpaperStore(join(ctx.profileContext.dir, NAMESPACE));
  ctx.effect(() => () => store.close(), `${NAMESPACE}: storage lifecycle`);
  await store.ready;

  const handlers = {
    get: () => store.get(),
    set: (payload: Record<string, unknown>) => store.set(payload),
    begin: ({ name, bytes }: Record<string, unknown>) => store.begin({ name, bytes }),
    chunk: ({ id, offset, data }: Record<string, unknown>) => store.chunk({ id, offset, data }),
    finish: ({ id }: Record<string, unknown>) => store.finish({ id }),
    cancel: ({ id }: Record<string, unknown>) => store.cancel({ id }),
    read: ({ id, offset }: Record<string, unknown>) => store.read({ id, offset }),
    remove: ({ id }: Record<string, unknown>) => store.remove({ id }),
  };

  for (const [method, invoke] of Object.entries(handlers)) {
    ctx.effect(
      () => ctx.connection.fetch.register(createRoute(method, invoke)),
      `${NAMESPACE}: ${method}`,
    );
  }

  ctx.effect(() => {
    const timer = setInterval(() => {
      void store.run(() => store.prune()).catch(() => undefined);
    }, 60_000);
    timer.unref();
    return () => clearInterval(timer);
  }, `${NAMESPACE}: expire incomplete uploads`);
}
