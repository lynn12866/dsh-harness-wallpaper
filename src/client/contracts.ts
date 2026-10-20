import type { ComponentType } from 'react';

export interface ThemePair {
  light: string;
  dark: string;
}

/** Narrow public-service adapter, verified against the bundled Harness runtime. */
export interface ClientContext {
  effect(setup: () => (() => void) | void, label: string): void;
  on(event: 'connection/reset' | 'theme/change', listener: () => void): void;
  connection: {
    rpc: {
      call(
        channel: string,
        method: string,
        payload: unknown,
        signal?: AbortSignal,
      ): Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }>;
    };
  };
  theme: {
    overrideTokens(source: string, tokens: Record<string, ThemePair>): () => void;
  };
  slots: {
    inject(name: string, setup: () => unknown): () => void;
    register(
      metadata: { name: string; id: string; order: number; label: () => string },
      component: ComponentType,
    ): unknown;
  };
}
