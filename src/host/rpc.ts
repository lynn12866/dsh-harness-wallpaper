import { NAMESPACE } from '../shared/constants.ts';
import { errorMessage, hasErrorCode, isRecord } from '../shared/types.ts';
import type { FetchRoute } from './contracts.ts';

const BODY_LIMIT = 720 * 1024;
type Invoke = (payload: Record<string, unknown>) => unknown | Promise<unknown>;

/** Exact Connection routes inherit Harness authentication and Desktop IPC. */
export function createRoute(method: string, invoke: Invoke): FetchRoute {
  const endpoint = `${NAMESPACE}/${method}`;

  return {
    path: `/api/${endpoint}`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      if (!request.headers.get('content-type')?.startsWith('application/json')) {
        return new Response('JSON required', { status: 415 });
      }
      if (Number(request.headers.get('content-length')) > BODY_LIMIT) {
        return new Response('Too large', { status: 413 });
      }

      let message: unknown;
      try {
        const body = await request.text();
        if (body.length > BODY_LIMIT) {
          return new Response('Too large', { status: 413 });
        }
        message = JSON.parse(body);
      } catch {
        return new Response('Invalid JSON', { status: 400 });
      }

      if (
        !isRecord(message) ||
        message.type !== 'client-request' ||
        typeof message.rpcId !== 'string' ||
        message.rpcId.length > 200 ||
        message.method !== endpoint ||
        !isRecord(message.payload)
      ) {
        return new Response('Invalid RPC envelope', { status: 400 });
      }

      let result: unknown;
      try {
        result = { ok: true, value: await invoke(message.payload) };
      } catch (error) {
        result = {
          ok: false,
          error: {
            code: `${NAMESPACE}/failed`,
            message: hasErrorCode(error, 'ENOENT')
              ? '壁纸文件已丢失，请重新上传。'
              : errorMessage(error),
            details: {},
          },
        };
      }

      return Response.json(
        { type: 'server-response', rpcId: message.rpcId, result },
        { headers: { 'cache-control': 'no-store' } },
      );
    },
  };
}
