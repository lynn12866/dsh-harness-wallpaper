import type { WallpaperConfig } from '../shared/types.ts';

type Patch = Partial<WallpaperConfig>;
type Key = keyof WallpaperConfig;

interface WriterCallbacks {
  saved(): void;
  failed(error: unknown): void;
}

/** Serialize saves and retry only edits that have not been superseded. */
export class SettingsWriter {
  private pending: Patch = {};
  private readonly revisions = new Map<Key, number>();
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private inFlight = 0;
  private readonly persist: (patch: Patch) => Promise<unknown>;
  private readonly callbacks: WriterCallbacks;

  constructor(persist: (patch: Patch) => Promise<unknown>, callbacks: WriterCallbacks) {
    this.persist = persist;
    this.callbacks = callbacks;
  }

  hasPending(): boolean {
    return Object.keys(this.pending).length > 0 || this.inFlight > 0;
  }

  stage(patch: Patch): void {
    for (const key of Object.keys(patch) as Key[]) {
      this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    }
    this.pending = { ...this.pending, ...patch };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, 240);
  }

  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.disposed) {
      return false;
    }
    const patch = this.pending;
    const revisions = new Map(this.revisions);
    this.pending = {};

    if (Object.keys(patch).length > 0) {
      this.inFlight += 1;
      this.queue = this.queue.then(async () => {
        try {
          await this.persist(patch);
          this.inFlight -= 1;
          if (!this.disposed && !this.hasPending()) {
            this.callbacks.saved();
          }
        } catch (error) {
          this.inFlight -= 1;
          if (this.disposed) {
            return;
          }
          const retry = Object.fromEntries(
            Object.entries(patch).filter(
              ([key]) => this.revisions.get(key as Key) === revisions.get(key as Key),
            ),
          ) as Patch;
          this.pending = { ...retry, ...this.pending };
          this.callbacks.failed(error);
        }
      });
    }

    await this.queue;
    return !this.hasPending();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
