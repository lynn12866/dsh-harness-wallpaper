import assert from 'node:assert/strict';
import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { HostContext, AgentTool, FetchRoute } from '../../src/host/contracts.ts';
import type { Api, Method, RpcCall } from '../../src/shared/types.ts';
import { NAMESPACE } from '../../src/shared/constants.ts';
import { apply } from '../../src/host/index.ts';

export async function mountHost(directory: string) {
  const routes = new Map<string, FetchRoute>();
  const tools = new Map<string, AgentTool>();
  const effects: (() => void | Promise<void>)[] = [];
  const ctx: HostContext = {
    profileContext: { dir: directory },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route);
          return () => {
            routes.delete(route.path);
          };
        },
      },
    },
    tools: {
      register(tool) {
        tools.set(tool.name, tool);
        return () => {
          tools.delete(tool.name);
        };
      },
    },
    workingDirectory: { ensure: async () => directory },
    fs: {
      async resolve(path, { cwd, signal }) {
        signal.throwIfAborted();
        const absolute = resolve(cwd, path);
        return { targetKey: absolute, displayPath: absolute };
      },
      async stat(target, signal) {
        signal.throwIfAborted();
        const info = await stat(target.targetKey);
        return {
          type: info.isFile() ? 'file' : 'directory',
          size: info.size,
          version: `${info.mtimeMs}:${info.size}`,
        };
      },
      async readByteRange(target, { offset, length }, signal) {
        signal.throwIfAborted();
        const handle = await open(target.targetKey, 'r');
        try {
          const bytes = Buffer.alloc(length);
          const { bytesRead } = await handle.read(bytes, 0, length, offset);
          return bytes.subarray(0, bytesRead);
        } finally {
          await handle.close();
        }
      },
    },
    effect(setup) {
      const dispose = setup();
      if (dispose) {
        effects.push(dispose);
      }
    },
  };
  await apply(ctx);

  const call: RpcCall = async <M extends Method>(
    method: M,
    payload: Api[M]['payload'],
    signal?: AbortSignal,
  ): Promise<Api[M]['result']> => {
    const route = routes.get(`/api/${NAMESPACE}/${method}`);
    assert.ok(route);
    const response = await route.fetch(
      new Request(`http://localhost${route.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'test',
          method: `${NAMESPACE}/${method}`,
          payload,
        }),
        signal,
      }),
    );
    const envelope = await response.json();
    if (!envelope.result.ok) {
      throw new Error(envelope.result.error.message);
    }
    return envelope.result.value as Api[M]['result'];
  };
  return {
    ctx,
    routes,
    tools,
    call,
    async dispose() {
      for (const dispose of effects.splice(0).reverse()) {
        await dispose();
      }
    },
  };
}
