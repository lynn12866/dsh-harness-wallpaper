export interface FetchRoute {
  path: string;
  methods: string[];
  requestBody: 'buffered';
  fetch(request: Request): Promise<Response>;
}

/** Public Cordis services consumed by the Host half on Harness 0.2.1-rc.2. */
export interface HostContext {
  profileContext: { dir: string };
  connection: {
    fetch: { register(route: FetchRoute): () => void };
  };
  effect(setup: () => (() => void | Promise<void>) | void, label: string): void;
}
