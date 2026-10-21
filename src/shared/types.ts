export type MediaKind = 'image' | 'video';
export type FillMode = 'cover' | 'contain';

export interface WallpaperConfig {
  enabled: boolean;
  selected: string;
  opacity: number;
  transparency: number;
  dim: number;
  blur: number;
  fit: FillMode;
  playing: boolean;
}

export interface MediaDescriptor {
  mime: string;
  kind: MediaKind;
}

export interface WallpaperAsset extends MediaDescriptor {
  id: string;
  name: string;
  bytes: number;
  createdAt: number;
}

export interface LibraryState {
  version: 1;
  config: WallpaperConfig;
  assets: WallpaperAsset[];
}

export interface LibrarySnapshot extends LibraryState {
  revision: string;
  limits: {
    maxBytes: number;
    chunkBytes: number;
    maxLibraryBytes: number;
    maxItems: number;
  };
}

export interface Api {
  get: { payload: Record<string, never>; result: LibrarySnapshot };
  watch: { payload: { revision: string }; result: LibrarySnapshot };
  set: { payload: Partial<WallpaperConfig>; result: LibrarySnapshot };
  begin: { payload: { name: string; bytes: number }; result: { id: string; chunkBytes: number } };
  chunk: { payload: { id: string; offset: number; data: string }; result: { received: number } };
  finish: { payload: { id: string }; result: LibrarySnapshot };
  cancel: { payload: { id: string }; result: Record<string, never> };
  read: { payload: { id: string; offset: number }; result: { data: string; bytes: number } };
  remove: { payload: { id: string }; result: LibrarySnapshot };
}

export type Method = keyof Api;
export type RpcCall = <M extends Method>(
  method: M,
  payload: Api[M]['payload'],
  signal?: AbortSignal,
) => Promise<Api[M]['result']>;

export type NumericSetting = 'opacity' | 'transparency' | 'dim' | 'blur';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}
