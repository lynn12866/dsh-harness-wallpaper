import type { LibrarySnapshot, MediaKind, WallpaperConfig } from '../shared/types.ts';

export interface LoadedMedia {
  id: string;
  url: string;
  kind: MediaKind;
}

export interface ClientState {
  config: WallpaperConfig | null;
  assets: LibrarySnapshot['assets'];
  limits: LibrarySnapshot['limits'] | null;
  ready: boolean;
  busy: boolean;
  uploading: boolean;
  progress: number;
  status: string;
  error: boolean;
  media: LoadedMedia | null;
}

export interface WallpaperSurface {
  render(state: ClientState): void;
  dispose(): void;
}
