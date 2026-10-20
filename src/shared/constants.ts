import type { WallpaperConfig } from './types.ts';

export const PACKAGE_NAME = 'dsh-harness-wallpaper';
export const NAMESPACE = PACKAGE_NAME;
export const CHUNK_BYTES = 512 * 1024;
export const MAX_BYTES = 100 * 1024 * 1024;
export const MAX_LIBRARY_BYTES = 500 * 1024 * 1024;
export const MAX_ITEMS = 20;

export const DEFAULTS: Readonly<WallpaperConfig> = Object.freeze({
  enabled: true,
  selected: 'aurora',
  opacity: 80,
  transparency: 72,
  dim: 20,
  blur: 0,
  fit: 'cover',
  playing: true,
});

export const PRESETS = ['aurora', 'ocean', 'sunset', 'night'] as const;
