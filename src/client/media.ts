import type { MediaKind } from '../shared/types.ts';

export function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  }
  return btoa(text);
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('已取消', 'AbortError');
  }
}

/** Decode locally before persisting a candidate; keep its URL until adoption. */
export async function checkMedia(
  file: File,
  signal: AbortSignal,
): Promise<{ url: string; kind: MediaKind }> {
  const url = URL.createObjectURL(file);
  const isVideo = /\.(mp4|webm|m4v|mov)$/i.test(file.name) || file.type.startsWith('video/');
  const media = isVideo ? document.createElement('video') : document.createElement('img');

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        media.onload = null;
        media.onloadeddata = null;
        media.onerror = null;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const timer = setTimeout(() => finish(new Error('媒体读取超时，请更换文件。')), 20_000);
      const abort = (): void => finish(new DOMException('已取消', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      media.onload = () => finish();
      media.onloadeddata = () => finish();
      media.onerror = () =>
        finish(new Error('无法解码媒体，请使用有效图片、H.264 MP4 或 VP9 WebM。'));

      if (media instanceof HTMLVideoElement) {
        media.muted = true;
        media.preload = 'auto';
      }
      media.src = url;
      if (signal.aborted) {
        abort();
      }
    });
    return { url, kind: isVideo ? 'video' : 'image' };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    if (media instanceof HTMLVideoElement) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
  }
}
