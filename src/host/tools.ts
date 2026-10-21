import { CHUNK_BYTES, MAX_BYTES, PRESETS } from '../shared/constants.ts';
import { isRecord } from '../shared/types.ts';
import type { LibrarySnapshot } from '../shared/types.ts';
import type { AgentTool, HostContext, ToolExecution } from './contracts.ts';
import { sniff } from './store.ts';
import type { WallpaperStore } from './store.ts';

const presetNames = ['极光', '深海', '落日', '夜航'];
const configProperties = {
  enabled: { type: 'boolean', description: '启用或关闭壁纸。' },
  selected: { type: 'string', description: 'wallpaper_list 返回的壁纸 id。' },
  opacity: { type: 'number', description: '壁纸不透明度，0–100%。' },
  transparency: { type: 'number', description: '界面透明度，0–100%。' },
  dim: { type: 'number', description: '阅读遮罩强度，0–100%。' },
  blur: { type: 'number', description: '模糊半径，0–30 px。' },
  fit: { type: 'string', enum: ['cover', 'contain'], description: '铺满或完整显示。' },
  playing: { type: 'boolean', description: '播放或暂停视频；不能暂停 GIF。' },
};

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', additionalProperties: false, properties, required };
}

const outputSchema = objectSchema(
  {
    config: objectSchema(configProperties, Object.keys(configProperties)),
    wallpapers: {
      type: 'array',
      items: objectSchema(
        {
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['preset', 'image', 'video'] },
        },
        ['id', 'name', 'kind'],
      ),
    },
  },
  ['config', 'wallpapers'],
);

function catalog(snapshot: LibrarySnapshot) {
  return {
    config: snapshot.config,
    wallpapers: [
      ...PRESETS.map((id, index) => ({ id, name: presetNames[index] ?? id, kind: 'preset' })),
      ...snapshot.assets.map(({ id, name, kind }) => ({ id, name, kind })),
    ],
  };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    throw new Error(`${label}不能为空，且长度不能超过 4096。`);
  }
  return value;
}

/** Import through the Agent filesystem provider, with bounded reads and cancellation cleanup. */
async function importMedia(
  ctx: HostContext,
  store: WallpaperStore,
  path: string,
  exec: ToolExecution,
): Promise<LibrarySnapshot> {
  if (!exec.agent) {
    throw new Error('导入壁纸需要 Agent 会话。');
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error('请提供文件系统路径，不能直接导入网络 URL。');
  }
  const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
  const target = await ctx.fs.resolve(path, { cwd, signal: exec.signal });
  const info = await ctx.fs.stat(target, exec.signal);
  if (!info || info.type !== 'file') {
    throw new Error('壁纸路径必须是可读取的普通文件。');
  }
  const size = info.size;
  if (size === undefined || !Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) {
    throw new Error('单个壁纸文件限 100 MiB，且不能为空。');
  }
  const head = await ctx.fs.readByteRange(
    target,
    { offset: 0, length: Math.min(4096, size) },
    exec.signal,
  );
  sniff(Buffer.from(head));
  exec.signal.throwIfAborted();
  const name = target.displayPath.split(/[\\/]/).at(-1) ?? '壁纸';
  const { id } = await store.begin({ name, bytes: size });
  try {
    for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
      exec.signal.throwIfAborted();
      const length = Math.min(CHUNK_BYTES, size - offset);
      const chunk = await ctx.fs.readByteRange(target, { offset, length }, exec.signal);
      if (chunk.byteLength !== length) {
        throw new Error('导入期间文件发生变化，请重试。');
      }
      await store.chunk({ id, offset, data: Buffer.from(chunk).toString('base64') });
    }
    const after = await ctx.fs.stat(target, exec.signal);
    if (!after || after.version !== info.version || after.size !== size) {
      throw new Error('导入期间文件发生变化，请重试。');
    }
    exec.signal.throwIfAborted();
    return await store.finish({ id });
  } catch (error) {
    await store.cancel({ id });
    throw error;
  }
}

export function createAgentTools(ctx: HostContext, store: WallpaperStore): AgentTool[] {
  function tool(
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    invoke: (args: Record<string, unknown>, exec: ToolExecution) => Promise<LibrarySnapshot>,
    readOnly = false,
  ): AgentTool {
    return {
      name,
      description,
      parameters: objectSchema(properties, required),
      output: {
        schema: outputSchema,
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      isConcurrencySafe: () => readOnly,
      async execute(args, exec) {
        exec.signal.throwIfAborted();
        if (
          !isRecord(args) ||
          Object.keys(args).some((key) => !Object.hasOwn(properties, key)) ||
          required.some((key) => !Object.hasOwn(args, key))
        ) {
          throw new Error('壁纸工具参数不正确。');
        }
        return catalog(await invoke(args, exec));
      },
    };
  }

  return [
    tool(
      'wallpaper_list',
      '查看 DeepSeek Harness 当前壁纸参数，以及内置和已上传壁纸的 id、名称和类型。切换前先查询，使用返回的 id；不返回媒体二进制内容。',
      {},
      [],
      () => store.get(),
      true,
    ),
    tool(
      'wallpaper_set',
      '调整 DeepSeek Harness 壁纸参数，保存后立即同步所有已连接窗口。只传需要修改的字段，其余设置保留。opacity 是壁纸不透明度，transparency 是界面透明度，均为 0–100；blur 为 0–30 px。playing 只控制视频，GIF 无法暂停。',
      configProperties,
      [],
      (args) => {
        if (!Object.keys(args).length) {
          throw new Error('请至少提供一个要修改的壁纸参数。');
        }
        return store.set(args);
      },
    ),
    tool(
      'wallpaper_switch',
      '切换并启用 DeepSeek Harness 的内置或已上传壁纸，立即生效，保留其他显示参数。id 必须来自 wallpaper_list。新文件先用 wallpaper_import 导入。',
      { id: { type: 'string', description: 'wallpaper_list 返回的 id。' } },
      ['id'],
      (args) => store.set({ selected: requiredString(args.id, '壁纸 id'), enabled: true }),
    ),
    tool(
      'wallpaper_import',
      '将用户指定且 Agent 能读取的图片、GIF、动态 WebP、APNG、MP4 或 WebM 文件复制到 DeepSeek Harness 壁纸库并立即启用。path 是 Agent 文件系统路径，相对路径基于当前会话目录。Web 部署使用服务器文件；不接受网络 URL，不删除源文件。单文件最多 100 MiB，媒体库最多 20 项、500 MiB；视频播放取决于客户端解码能力。',
      { path: { type: 'string', description: '用户指定的媒体文件路径，不能是 URL。' } },
      ['path'],
      (args, exec) => importMedia(ctx, store, requiredString(args.path, '文件路径'), exec),
    ),
  ];
}
