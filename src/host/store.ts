import { mkdir, readFile, writeFile, rename, rm, readdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  CHUNK_BYTES,
  MAX_BYTES,
  MAX_LIBRARY_BYTES,
  MAX_ITEMS,
  DEFAULTS,
  PRESETS,
} from '../shared/constants.ts';
import { hasErrorCode, isRecord } from '../shared/types.ts';
import type {
  LibrarySnapshot,
  LibraryState,
  MediaDescriptor,
  WallpaperAsset,
  WallpaperConfig,
} from '../shared/types.ts';

interface UploadSession {
  id: string;
  name: string;
  bytes: number;
  received: number;
  touched: number;
}
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const TTL = 15 * 60 * 1000;
function fail(message: string): never {
  throw new Error(message);
}

export function sniff(bytes: Buffer): MediaDescriptor {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mime: 'image/png', kind: 'image' };
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return { mime: 'image/jpeg', kind: 'image' };
  }
  if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) {
    return { mime: 'image/gif', kind: 'image' };
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', kind: 'image' };
  }
  if (bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brands = bytes.toString('ascii', 8, 64);
    if (/avif|avis/.test(brands)) {
      return { mime: 'image/avif', kind: 'image' };
    }
    if (/isom|iso[2-9]|mp4[12]|avc1|M4V |qt {2}/.test(brands)) {
      return { mime: 'video/mp4', kind: 'video' };
    }
  }
  if (
    bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) &&
    bytes.subarray(0, 4096).includes(Buffer.from('webm'))
  ) {
    return { mime: 'video/webm', kind: 'video' };
  }
  fail('不支持的媒体内容，请使用 PNG、JPEG、GIF、WebP、AVIF、MP4 或 WebM。');
}

export function validateConfig(value: unknown, assets: WallpaperAsset[]): Partial<WallpaperConfig> {
  if (!isRecord(value)) {
    fail('设置格式不正确。');
  }
  const next: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULTS, key)) {
      fail('未知的设置项。');
    }
    if (['enabled', 'playing'].includes(key)) {
      if (typeof v !== 'boolean') {
        fail('开关设置不正确。');
      }
    } else if (['opacity', 'transparency', 'dim', 'blur'].includes(key)) {
      if (
        typeof v !== 'number' ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > (key === 'blur' ? 30 : 100)
      ) {
        fail('设置数值超出范围。');
      }
    } else if (key === 'fit') {
      if (typeof v !== 'string' || !['cover', 'contain'].includes(v)) {
        fail('填充方式不正确。');
      }
    } else if (key === 'selected') {
      if (
        typeof v !== 'string' ||
        (!PRESETS.some((preset) => preset === v) && !assets.some((a) => a.id === v))
      ) {
        fail('该壁纸已不存在。');
      }
    }
    next[key] = v;
  }
  return next as Partial<WallpaperConfig>;
}

/** All mutations share a queue; metadata is committed with an atomic rename. */
export class WallpaperStore {
  readonly directory: string;
  readonly file: string;
  readonly ready: Promise<void>;
  private state: LibraryState;
  private readonly uploads = new Map<string, UploadSession>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private revision = randomUUID();
  private readonly watchers = new Set<() => void>();

  constructor(directory: string) {
    this.directory = directory;
    this.file = join(directory, 'library.json');
    this.state = { version: 1, config: { ...DEFAULTS }, assets: [] };
    this.ready = this.init();
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const saved: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!isRecord(saved)) {
        fail('壁纸库元数据损坏。');
      }
      if (saved.version !== 1 || !Array.isArray(saved.assets) || saved.assets.length > 20) {
        fail('壁纸库元数据损坏，请备份后修复 library.json。');
      }
      for (const a of saved.assets) {
        if (
          !isRecord(a) ||
          typeof a.id !== 'string' ||
          !UUID.test(a.id) ||
          !['image', 'video'].some((kind) => kind === a.kind) ||
          typeof a.name !== 'string' ||
          typeof a.mime !== 'string' ||
          typeof a.bytes !== 'number' ||
          !Number.isSafeInteger(a.bytes) ||
          a.bytes < 1 ||
          a.bytes > MAX_BYTES
        ) {
          fail('壁纸库元数据损坏。');
        }
      }
      this.state = {
        version: 1,
        assets: saved.assets as WallpaperAsset[],
        config: { ...DEFAULTS, ...validateConfig(saved.config, saved.assets as WallpaperAsset[]) },
      };
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) {
        if (error instanceof SyntaxError) {
          fail('壁纸库元数据损坏，请备份后修复 library.json。');
        }
        throw error;
      }
    }
    // Interrupted uploads never enter the library. Remove their partial files at boot.
    const keep = new Set(this.state.assets.map((a) => a.id));
    for (const name of await readdir(this.directory)) {
      if (
        /^[a-f0-9-]+\.part$/.test(name) ||
        (UUID.test(name) && !keep.has(name)) ||
        /^library\.[a-f0-9-]+\.tmp$/.test(name)
      ) {
        await rm(join(this.directory, name), { force: true });
      }
    }
  }
  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      await this.ready;
      if (this.closed) {
        fail('插件已停用。');
      }
      return fn();
    });
    this.queue = task.catch(() => {});
    return task;
  }
  snapshot(): LibrarySnapshot {
    return structuredClone({
      ...this.state,
      revision: this.revision,
      limits: {
        maxBytes: MAX_BYTES,
        chunkBytes: CHUNK_BYTES,
        maxLibraryBytes: MAX_LIBRARY_BYTES,
        maxItems: MAX_ITEMS,
      },
    });
  }
  private async commit(next: LibraryState): Promise<void> {
    const temp = join(this.directory, `library.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(temp, this.file);
      this.state = next;
      this.revision = randomUUID();
      for (const changed of [...this.watchers]) {
        changed();
      }
    } finally {
      await rm(temp, { force: true });
    }
  }
  get() {
    return this.run(() => this.snapshot());
  }
  /** Long polling uses the authenticated Connection carrier and never holds the mutation queue. */
  async watch(revision: unknown, signal: AbortSignal): Promise<LibrarySnapshot> {
    await this.ready;
    signal.throwIfAborted();
    if (this.closed) {
      fail('插件已停用。');
    }
    if (typeof revision !== 'string' || revision.length > 100) {
      fail('同步版本无效。');
    }
    if (revision !== this.revision) {
      return this.snapshot();
    }
    if (this.watchers.size >= 64) {
      fail('壁纸同步连接过多，请稍后重试。');
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.watchers.delete(changed);
        signal.removeEventListener('abort', aborted);
      };
      const changed = () => {
        cleanup();
        resolve(this.snapshot());
      };
      const aborted = () => {
        cleanup();
        reject(signal.reason);
      };
      const timer = setTimeout(changed, 20_000);
      this.watchers.add(changed);
      signal.addEventListener('abort', aborted, { once: true });
    });
  }
  set(patch: unknown): Promise<LibrarySnapshot> {
    return this.run(async () => {
      await this.commit({
        ...this.state,
        config: { ...this.state.config, ...validateConfig(patch, this.state.assets) },
      });
      return this.snapshot();
    });
  }
  begin({ name, bytes }: { name: unknown; bytes: unknown }) {
    return this.run(async () => {
      await this.prune();
      if (this.uploads.size >= 2) {
        fail('请先完成或取消正在上传的文件。');
      }
      if (typeof name !== 'string' || !name.trim() || name.length > 240) {
        fail('文件名无效。');
      }
      if (
        typeof bytes !== 'number' ||
        !Number.isSafeInteger(bytes) ||
        bytes < 1 ||
        bytes > MAX_BYTES
      ) {
        fail('单个文件限 100 MiB。');
      }
      if (this.state.assets.length + this.uploads.size >= 20) {
        fail('壁纸库最多保留 20 个文件，请先删除旧文件。');
      }
      const total =
        this.state.assets.reduce((n, a) => n + a.bytes, 0) +
        [...this.uploads.values()].reduce((n, a) => n + a.bytes, 0);
      if (total + bytes > MAX_LIBRARY_BYTES) {
        fail('壁纸库总容量上限为 500 MiB，请先删除旧文件。');
      }
      const id = randomUUID();
      await writeFile(join(this.directory, id + '.part'), '', { mode: 0o600, flag: 'wx' });
      this.uploads.set(id, {
        id,
        name: Array.from(name)
          .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
          .join(''),
        bytes,
        received: 0,
        touched: Date.now(),
      });
      return { id, chunkBytes: CHUNK_BYTES };
    });
  }
  chunk({ id, offset, data }: { id: unknown; offset: unknown; data: unknown }) {
    return this.run(async () => {
      if (typeof id !== 'string') {
        fail('文件标识无效。');
      }
      const item = this.uploads.get(id);
      if (!item || Date.now() - item.touched > TTL) {
        fail('上传已过期，请重新选择文件。');
      }
      if (offset !== item.received) {
        fail('上传分块顺序不正确。');
      }
      if (
        typeof data !== 'string' ||
        data.length > Math.ceil(CHUNK_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
      ) {
        fail('上传分块格式不正确。');
      }
      const bytes = Buffer.from(data, 'base64');
      if (
        !bytes.length ||
        bytes.length > CHUNK_BYTES ||
        item.received + bytes.length > item.bytes
      ) {
        fail('上传分块大小不正确。');
      }
      const handle = await open(join(this.directory, id + '.part'), 'a');
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      item.received += bytes.length;
      item.touched = Date.now();
      return { received: item.received };
    });
  }
  finish({ id }: { id: unknown }) {
    return this.run(async () => {
      if (typeof id !== 'string') {
        fail('文件标识无效。');
      }
      const item = this.uploads.get(id);
      if (!item || item.received !== item.bytes) {
        fail('文件尚未上传完整。');
      }
      const handle = await open(join(this.directory, id + '.part'), 'r');
      const head = Buffer.alloc(Math.min(4096, item.bytes));
      try {
        await handle.read(head, 0, head.length, 0);
      } finally {
        await handle.close();
      }
      let media;
      try {
        media = sniff(head);
      } catch (error) {
        await this.cancelInternal(id);
        throw error;
      }
      const asset = { id, name: item.name, bytes: item.bytes, ...media, createdAt: Date.now() };
      await rename(join(this.directory, id + '.part'), join(this.directory, id));
      try {
        await this.commit({
          ...this.state,
          assets: [...this.state.assets, asset],
          config: { ...this.state.config, enabled: true, selected: id },
        });
      } catch (error) {
        await rm(join(this.directory, id), { force: true });
        this.uploads.delete(id);
        throw error;
      }
      this.uploads.delete(id);
      return this.snapshot();
    });
  }
  private async cancelInternal(id: string): Promise<void> {
    if (!UUID.test(id)) {
      fail('文件标识无效。');
    }
    await rm(join(this.directory, id + '.part'), { force: true });
    this.uploads.delete(id);
  }
  cancel({ id }: { id: unknown }) {
    return this.run(async () => {
      if (typeof id !== 'string') {
        fail('文件标识无效。');
      }
      await this.cancelInternal(id);
      return {};
    });
  }
  read({ id, offset }: { id: unknown; offset: unknown }) {
    return this.run(async () => {
      const asset = this.state.assets.find((a) => a.id === id);
      if (!asset || typeof id !== 'string' || !UUID.test(id)) {
        fail('壁纸不存在。');
      }
      if (
        typeof offset !== 'number' ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset >= asset.bytes
      ) {
        fail('读取位置无效。');
      }
      const handle = await open(join(this.directory, id), 'r');
      try {
        const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, asset.bytes - offset));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (bytesRead !== buffer.length) {
          fail('壁纸文件不完整，请重新上传。');
        }
        return { data: buffer.toString('base64'), bytes: bytesRead };
      } finally {
        await handle.close();
      }
    });
  }
  remove({ id }: { id: unknown }) {
    return this.run(async () => {
      if (typeof id !== 'string' || !UUID.test(id) || !this.state.assets.some((a) => a.id === id)) {
        fail('壁纸不存在。');
      }
      const config = { ...this.state.config };
      if (config.selected === id) {
        config.selected = 'aurora';
        config.enabled = false;
      }
      await this.commit({
        ...this.state,
        config,
        assets: this.state.assets.filter((a) => a.id !== id),
      });
      await rm(join(this.directory, id), { force: true });
      return this.snapshot();
    });
  }
  async prune(): Promise<void> {
    for (const [id, item] of this.uploads) {
      if (Date.now() - item.touched > TTL) {
        await this.cancelInternal(id);
      }
    }
  }
  async close(): Promise<void> {
    await this.queue;
    await this.ready.catch(() => {});
    this.closed = true;
    for (const changed of [...this.watchers]) {
      changed();
    }
    for (const id of [...this.uploads.keys()]) {
      await this.cancelInternal(id);
    }
  }
}
