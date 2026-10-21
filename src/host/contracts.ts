export interface FetchRoute {
  path: string;
  methods: string[];
  requestBody: 'buffered';
  fetch(request: Request): Promise<Response>;
}

export interface AgentRef {
  session: object;
}

export interface ToolExecution {
  signal: AbortSignal;
  agent?: AgentRef;
}

/** Native registry-ready ToolDefinition; schemas use Harness's public JSON Schema subset. */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    schema: Record<string, unknown>;
    render(args: unknown, value: unknown): { type: 'text'; text: string }[];
  };
  isConcurrencySafe(): boolean;
  execute(args: unknown, exec: ToolExecution): Promise<unknown>;
}

export interface FileTarget {
  targetKey: string;
  displayPath: string;
}

export interface FileInfo {
  type: string;
  size?: number;
  version: string;
}

/** Public Cordis services consumed by the Host half on Harness 0.2.1-rc.2. */
export interface HostContext {
  profileContext: { dir: string };
  connection: {
    fetch: { register(route: FetchRoute): () => void };
  };
  tools: { register(tool: AgentTool): () => void };
  workingDirectory: { ensure(agent: AgentRef, signal: AbortSignal): Promise<string> };
  fs: {
    resolve(path: string, options: { cwd: string; signal: AbortSignal }): Promise<FileTarget>;
    stat(target: FileTarget, signal: AbortSignal): Promise<FileInfo | undefined>;
    readByteRange(
      target: FileTarget,
      range: { offset: number; length: number },
      signal: AbortSignal,
    ): Promise<Uint8Array>;
  };
  effect(setup: () => (() => void | Promise<void>) | void, label: string): void;
}
