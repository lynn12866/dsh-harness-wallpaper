import { PACKAGE_NAME } from '../shared/constants.ts';
import type { WallpaperConfig } from '../shared/types.ts';
import type { ClientContext, ThemePair } from './contracts.ts';
import { presets } from './presets.ts';
import type { ClientState, WallpaperSurface } from './types.ts';
import wallpaperCss from './wallpaper.css';

/** Own only the decorative layer and a reversible native theme-token override. */
export class WallpaperRenderer implements WallpaperSurface {
  private readonly ctx: ClientContext;
  private readonly report: (error: Error) => void;
  private readonly layer = document.createElement('div');
  private readonly stylesheet = document.createElement('style');
  private readonly motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private releaseTokens: () => void = () => undefined;
  private mediaElement: HTMLDivElement | HTMLImageElement | HTMLVideoElement | null = null;
  private veil: HTMLDivElement | null = null;
  private config: WallpaperConfig | null = null;
  private mediaVersion = '';
  private tokenVersion = '';
  private disposed = false;

  constructor(ctx: ClientContext, report: (error: Error) => void) {
    this.ctx = ctx;
    this.report = report;
    this.layer.id = 'dsh-harness-wallpaper-backdrop';
    this.layer.hidden = true;
    this.layer.setAttribute('aria-hidden', 'true');
    this.stylesheet.dataset.plugin = PACKAGE_NAME;
    this.stylesheet.textContent = wallpaperCss;
    document.head.append(this.stylesheet);
    document.body.prepend(this.layer);
    document.addEventListener('visibilitychange', this.syncPlayback);
    this.motion.addEventListener('change', this.syncPlayback);
  }

  render(state: ClientState): void {
    if (this.disposed) {
      return;
    }
    const config = state.config;
    this.config = config;
    const preset = config ? presets[config.selected] : undefined;
    const media = state.media?.id === config?.selected ? state.media : null;

    if (!config?.enabled || (!preset && !media)) {
      this.clear();
      return;
    }

    this.layer.hidden = false;
    document.body.classList.add('dsh-harness-wallpaper-active');
    this.overrideSurfaces(config.transparency);
    const version = `${config.selected}:${media?.url ?? ''}`;

    if (version !== this.mediaVersion) {
      this.clearMedia();
      this.mediaVersion = version;
      if (preset) {
        const gradient = document.createElement('div');
        gradient.style.backgroundImage = preset.background;
        this.mediaElement = gradient;
      } else if (media) {
        const element = document.createElement(media.kind === 'video' ? 'video' : 'img');
        if (element instanceof HTMLVideoElement) {
          element.muted = true;
          element.loop = true;
          element.playsInline = true;
          element.preload = 'auto';
        } else {
          element.alt = '';
        }
        element.src = media.url;
        element.addEventListener('error', () => {
          if (!this.disposed) {
            this.clear();
            this.report(new Error('媒体无法解码，请重新上传兼容的图片或视频。'));
          }
        });
        this.mediaElement = element;
      }
      this.veil = document.createElement('div');
      this.veil.className = 'dsh-harness-wallpaper-veil';
      if (this.mediaElement) {
        this.mediaElement.className = 'dsh-harness-wallpaper-media';
        this.layer.append(this.mediaElement, this.veil);
      }
    }

    if (this.mediaElement && this.veil) {
      const style = this.mediaElement.style;
      style.opacity = String(config.opacity / 100);
      style.filter = `blur(${config.blur}px)`;
      style.transform = config.blur > 0 ? 'scale(1.07)' : '';
      style.objectFit = config.fit;
      style.backgroundSize = config.fit;
      this.veil.style.opacity = String(config.dim / 100);
    }
    this.syncPlayback();
  }

  private overrideSurfaces(transparency: number): void {
    const version = String(transparency);
    if (version === this.tokenVersion) {
      return;
    }
    this.tokenVersion = version;
    const strength = `${100 - transparency}%`;
    const tokens: Record<string, ThemePair> = {
      '--dsw-alias-bg-base': { light: 'transparent', dark: 'transparent' },
    };
    for (const token of [
      '--dsw-specific-sidebar-fill',
      '--dsw-specific-bubble',
      '--dsw-specific-bubble-highlight',
      '--dsw-specific-input-major',
    ]) {
      tokens[token] = {
        light: `color-mix(in srgb, var(--dsw-static-neutral-bluish-50) ${strength}, transparent)`,
        dark: `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${strength}, transparent)`,
      };
    }
    // Keep modal, menu and control surfaces in their unmodified native palette.
    this.releaseTokens = this.ctx.theme.overrideTokens(PACKAGE_NAME, tokens);
  }

  private readonly syncPlayback = (): void => {
    const video = this.mediaElement;
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }
    if (this.config?.enabled && this.config.playing && !document.hidden && !this.motion.matches) {
      void video.play().catch(() => {
        if (!this.disposed) {
          this.report(new Error('视频未能自动播放，请点击「播放视频」重试。'));
        }
      });
    } else {
      video.pause();
    }
  };

  private clearMedia(): void {
    if (this.mediaElement instanceof HTMLVideoElement) {
      this.mediaElement.pause();
      this.mediaElement.removeAttribute('src');
      this.mediaElement.load();
    }
    this.layer.replaceChildren();
    this.mediaElement = null;
    this.veil = null;
    this.mediaVersion = '';
  }

  private clear(): void {
    this.layer.hidden = true;
    this.clearMedia();
    this.releaseTokens();
    this.releaseTokens = () => undefined;
    this.tokenVersion = '';
    document.body.classList.remove('dsh-harness-wallpaper-active');
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    this.layer.remove();
    this.stylesheet.remove();
    document.removeEventListener('visibilitychange', this.syncPlayback);
    this.motion.removeEventListener('change', this.syncPlayback);
  }
}
