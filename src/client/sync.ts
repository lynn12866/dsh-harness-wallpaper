import type { LibrarySnapshot, RpcCall } from '../shared/types.ts';

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) {
      finish();
    }
  });
}

/** One cancellable long poll per window; deferred snapshots are fetched again after local edits. */
export class WallpaperSync {
  private controller: AbortController | undefined;
  private readonly call: RpcCall;
  private readonly accept: (snapshot: LibrarySnapshot) => boolean;
  private readonly failed: (error: unknown) => void;

  constructor(
    call: RpcCall,
    accept: (snapshot: LibrarySnapshot) => boolean,
    failed: (error: unknown) => void,
  ) {
    this.call = call;
    this.accept = accept;
    this.failed = failed;
  }

  start(): void {
    this.stop();
    this.controller = new AbortController();
    void this.run(this.controller.signal);
  }

  private async run(signal: AbortSignal): Promise<void> {
    let revision = '';
    while (!signal.aborted) {
      try {
        let snapshot = await this.call('watch', { revision }, signal);
        if (signal.aborted) {
          return;
        }
        if (snapshot.revision === revision) {
          continue;
        }
        while (!this.accept(snapshot)) {
          await delay(250, signal);
          if (signal.aborted) {
            return;
          }
          snapshot = await this.call('get', {}, signal);
          if (signal.aborted) {
            return;
          }
        }
        revision = snapshot.revision;
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        this.failed(error);
        revision = '';
        await delay(2_000, signal);
      }
    }
  }

  stop(): void {
    this.controller?.abort();
    this.controller = undefined;
  }
}
