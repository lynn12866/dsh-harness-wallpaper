import * as React from 'react';
import { NAMESPACE, PACKAGE_NAME } from '../shared/constants.ts';
import type { Api, Method, RpcCall } from '../shared/types.ts';
import type { ClientContext } from './contracts.ts';
import { WallpaperController } from './controller.ts';
import { WallpaperRenderer } from './renderer.ts';
import { WallpaperSettings } from './settings.tsx';
import settingsCss from './settings.css';

export const inject = ['slots', 'connection', 'theme'];

export function apply(ctx: ClientContext): void {
  // Keep the transport's unknown-to-contract assertion at this one boundary.
  const call: RpcCall = async <M extends Method>(
    method: M,
    payload: Api[M]['payload'],
    signal?: AbortSignal,
  ): Promise<Api[M]['result']> => {
    const result = await ctx.connection.rpc.call('/api', `${NAMESPACE}/${method}`, payload, signal);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.value as Api[M]['result'];
  };

  const renderer = new WallpaperRenderer(ctx, (error) => controller.report(error));
  const controller = new WallpaperController(call, renderer);

  ctx.effect(() => {
    const stylesheet = document.createElement('style');
    stylesheet.dataset.plugin = PACKAGE_NAME;
    stylesheet.textContent = settingsCss;
    document.head.append(stylesheet);
    return () => stylesheet.remove();
  }, 'dsh-harness-wallpaper: settings layout');

  ctx.effect(
    () =>
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: NAMESPACE, order: 45, label: () => '壁纸' },
          () => <WallpaperSettings controller={controller} />,
        ),
      ),
    'dsh-harness-wallpaper: native settings',
  );
  ctx.on('connection/reset', () => {
    void controller.reload();
  });
  ctx.effect(() => () => controller.dispose(), 'dsh-harness-wallpaper: renderer lifecycle');
  void controller.reload();
}
