import { errorMessage } from '../shared/types.ts';
import type { LibrarySnapshot, RpcCall, WallpaperConfig } from '../shared/types.ts';
import { checkMedia, fromBase64, throwIfAborted, toBase64 } from './media.ts';
import { presets } from './presets.ts';
import { SettingsWriter } from './settings-writer.ts';
import type { ClientState, LoadedMedia, WallpaperSurface } from './types.ts';

export class WallpaperController {
  private state: ClientState = {
    config: null,
    assets: [],
    limits: null,
    ready: false,
    busy: false,
    uploading: false,
    progress: 0,
    status: '正在读取壁纸设置…',
    error: false,
    media: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly call: RpcCall;
  private readonly surface: WallpaperSurface;
  private readonly writer: SettingsWriter;
  private alive = true;
  private loadController: AbortController | undefined;
  private uploadController: AbortController | undefined;

  constructor(call: RpcCall, surface: WallpaperSurface) {
    this.call = call;
    this.surface = surface;
    this.writer = new SettingsWriter((patch) => call('set', patch), {
      saved: () => this.publish({ status: '已保存', error: false }),
      failed: (error) => this.report(new Error(`保存失败：${errorMessage(error)} 请重试保存。`)),
    });
  }

  readonly getSnapshot = (): ClientState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly report = (error: unknown): void => {
    this.publish({ status: errorMessage(error), error: true });
  };

  hasUnsavedChanges(): boolean {
    return this.writer.hasPending();
  }

  update(patch: Partial<WallpaperConfig>): void {
    if (!this.state.ready || this.state.busy || !this.state.config) {
      return;
    }
    this.writer.stage(patch);
    this.publish({
      config: { ...this.state.config, ...patch },
      status: '正在保存…',
      error: false,
    });
    this.surface.render(this.state);
    if ('selected' in patch || 'enabled' in patch) {
      void this.loadSelected();
    }
  }

  async retrySave(): Promise<void> {
    this.publish({ status: '正在保存…', error: false });
    await this.writer.flush();
  }

  cancelUpload(): void {
    this.uploadController?.abort();
  }

  async reload(): Promise<void> {
    if (this.state.busy || this.writer.hasPending()) {
      return;
    }
    try {
      this.adopt(await this.call('get', {}));
      await this.loadSelected();
      if (!this.state.error) {
        this.publish({ status: '已保存', error: false });
      }
    } catch (error) {
      this.report(error);
    }
  }

  async upload(file: File | undefined): Promise<void> {
    if (!file || !this.state.ready || this.state.busy || !this.state.limits) {
      return;
    }
    if (!/\.(png|jpe?g|gif|webp|avif|mp4|webm|m4v|mov)$/i.test(file.name)) {
      this.report(new Error('请上传 PNG、JPEG、GIF、WebP、AVIF、MP4 或 WebM。'));
      return;
    }
    if (file.size < 1 || file.size > this.state.limits.maxBytes) {
      this.report(new Error('单个文件限 100 MiB，且不能为空。'));
      return;
    }

    const controller = new AbortController();
    this.uploadController = controller;
    this.publish({
      busy: true,
      uploading: true,
      progress: 0,
      status: '正在检查媒体…',
      error: false,
    });
    let id: string | undefined;
    let checked: Awaited<ReturnType<typeof checkMedia>> | undefined;

    try {
      checked = await checkMedia(file, controller.signal);
      if (!(await this.writer.flush())) {
        throw new Error('请先重试保存当前设置。');
      }
      throwIfAborted(controller.signal);
      const started = await this.call(
        'begin',
        { name: file.name, bytes: file.size },
        controller.signal,
      );
      id = started.id;

      for (let offset = 0; offset < file.size;) {
        throwIfAborted(controller.signal);
        const chunk = new Uint8Array(
          await file.slice(offset, offset + started.chunkBytes).arrayBuffer(),
        );
        const result = await this.call(
          'chunk',
          { id, offset, data: toBase64(chunk) },
          controller.signal,
        );
        if (result.received !== offset + chunk.byteLength) {
          throw new Error('上传分块确认不完整，请重新上传。');
        }
        offset = result.received;
        const progress = Math.round((offset / file.size) * 100);
        this.publish({ progress, status: `正在保存到本机… ${progress}%` });
      }

      const snapshot = await this.call('finish', { id }, controller.signal);
      const asset = snapshot.assets.find((item) => item.id === id);
      if (!asset) {
        throw new Error('上传已完成，但媒体库中没有该文件，请重新载入。');
      }
      this.loadController?.abort();
      this.adopt(snapshot);
      this.replaceMedia({ id, url: checked.url, kind: asset.kind });
      checked = undefined;
      this.publish({ status: '已保存并应用', error: false });
    } catch (error) {
      if (id) {
        try {
          await this.call('cancel', { id });
        } catch {
          // Interrupted uploads also expire on the Host and are removed at boot.
        }
      }
      if (controller.signal.aborted) {
        this.publish({ status: '已取消上传', error: false });
      } else {
        this.report(error);
      }
    } finally {
      if (checked) {
        URL.revokeObjectURL(checked.url);
      }
      this.uploadController = undefined;
      this.publish({ busy: false, uploading: false });
    }
  }

  async remove(id: string): Promise<void> {
    if (this.state.busy) {
      return;
    }
    this.publish({ busy: true, status: '正在删除…', error: false });
    try {
      if (!(await this.writer.flush())) {
        throw new Error('请先重试保存当前设置。');
      }
      this.adopt(await this.call('remove', { id }));
      await this.loadSelected();
      this.publish({ status: '已删除', error: false });
    } catch (error) {
      this.report(error);
    } finally {
      this.publish({ busy: false });
    }
  }

  private publish(patch: Partial<ClientState>): void {
    if (!this.alive) {
      return;
    }
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private adopt(snapshot: LibrarySnapshot): void {
    this.publish({
      config: snapshot.config,
      assets: snapshot.assets,
      limits: snapshot.limits,
      ready: true,
    });
    this.surface.render(this.state);
  }

  private replaceMedia(media: LoadedMedia | null): void {
    const previous = this.state.media;
    this.publish({ media });
    this.surface.render(this.state);
    if (previous && previous.url !== media?.url) {
      URL.revokeObjectURL(previous.url);
    }
  }

  private async loadSelected(): Promise<void> {
    this.loadController?.abort();
    const config = this.state.config;
    if (!config?.enabled || presets[config.selected]) {
      this.replaceMedia(null);
      return;
    }
    if (this.state.media?.id === config.selected) {
      this.surface.render(this.state);
      return;
    }
    const asset = this.state.assets.find((item) => item.id === config.selected);
    if (!asset) {
      return;
    }

    const controller = new AbortController();
    this.loadController = controller;
    this.publish({ status: `正在载入 ${asset.name}…`, error: false });
    try {
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      for (let offset = 0; offset < asset.bytes;) {
        const result = await this.call('read', { id: asset.id, offset }, controller.signal);
        if (controller.signal.aborted || !this.alive) {
          return;
        }
        const chunk = fromBase64(result.data);
        if (
          chunk.byteLength !== result.bytes ||
          result.bytes < 1 ||
          offset + result.bytes > asset.bytes
        ) {
          throw new Error('壁纸分块不完整，请重新上传。');
        }
        chunks.push(chunk);
        offset += chunk.byteLength;
      }
      if (!controller.signal.aborted && this.alive) {
        this.replaceMedia({
          id: asset.id,
          url: URL.createObjectURL(new Blob(chunks, { type: asset.mime })),
          kind: asset.kind,
        });
        this.publish({ status: '已保存', error: false });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this.report(error);
      }
    }
  }

  dispose(): void {
    this.alive = false;
    this.loadController?.abort();
    this.uploadController?.abort();
    this.writer.dispose();
    this.surface.dispose();
    if (this.state.media) {
      URL.revokeObjectURL(this.state.media.url);
    }
    this.listeners.clear();
  }
}
