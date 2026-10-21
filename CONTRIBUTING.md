# 开发说明

要求 Node.js ≥22.18、pnpm 11.5.0。业务、构建与发布脚本均使用 TypeScript。

```sh
pnpm install --frozen-lockfile
pnpm format
pnpm check
pnpm pack --pack-destination artifacts
```

## 结构与规范

- `src/client/`：Harness 设置页、保存队列、实时同步、媒体加载与壁纸渲染。
- `src/host/`：原生 Agent 工具、Connection Fetch 路由、输入校验、分块上传和本地存储。
- `src/shared/`：共享类型与常量。`locale/`：插件管理页的中英文名称、描述。
- UI 和 React 由 Harness 提供；`harness-ui.d.ts` 只声明本插件使用的接口，不复制组件实现。
- TypeScript strict、ESLint、Prettier；两空格缩进、100 列、分号和单引号，构建产物不压缩。

## Agent 与同步

通过 `ctx.tools.register()` 注册标准工具定义，不打包 Harness 的工具运行时。参数 schema 使用 Harness 支持的 JSON Schema 子集；数值范围与壁纸 id 在存储入口验证。导入通过 `ctx.fs` 与 `ctx.workingDirectory` 读取会话文件，分块复制并检查源文件版本，取消或失败时清理未完成文件。

客户端通过认证 Connection 的 `watch` 路由等待变更；保存成功后唤醒所有等待窗口，空闲等待最多 20 秒。请求取消、插件停用或窗口销毁时清理监听。滑块仍有待保存修改时暂缓接收外部快照，保存完成后重新读取最新状态，避免旧快照覆盖当前编辑。

## 跨平台

Host 使用 Node.js 的 `path`、`fs` 和 `crypto`，文件存于 Harness 提供的 profile 下的 `dsh-harness-wallpaper/` 目录，不依赖 macOS 目录。媒体使用 UUID 文件名，上传原名只用于显示。客户端使用 Chromium / 现代浏览器的标准媒体 API，不使用系统专属窗口接口。

`.github/workflows/verify.yml` 在 Windows、macOS、Linux 上分别使用 Node.js 22 / 24 执行完整检查；配置存在不代表已经运行成功。桌面渲染、解码器和系统减少动态效果仍需各系统实机验证。

## npm 发布

`pnpm release` 依次运行 `npm login --auth-type=web`、`npm whoami`、`npm publish`，目标固定为 npm 官方 registry、公有访问。`prepack` 会执行完整检查；登录、身份检查或构建失败即终止。Windows 通过系统命令解释器运行固定的 npm 命令，拒绝额外参数。

`pnpm release --dry-run` 只执行 `npm pack --dry-run` 和相同的检查，不登录、不发布、不生成 tarball。版本号由维护者在发布前更新；npm 的双因素验证在终端或浏览器内完成，脚本不接收密码或令牌。

发布文件由 `package.json` 的 `files` 白名单限定，只包含编译后的 JavaScript、Harness 配置、语言文件、图标、截图、README 和许可证。构建不生成 source map 或类型声明；TypeScript 源码、测试、构建／发布脚本和开发配置只保留在源码项目中。`pnpm check:package` 检查 npm 实际打包清单，发现多余文件或缺少运行入口时终止发布。

命令行为参见 npm 官方的 [login](https://docs.npmjs.com/cli/v11/commands/npm-login/) 与 [publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/) 文档。
