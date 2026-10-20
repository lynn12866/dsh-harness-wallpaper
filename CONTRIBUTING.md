# 开发说明

要求 Node.js ≥22.18、pnpm 11.5.0。业务、构建与发布脚本均使用 TypeScript。

```sh
pnpm install --frozen-lockfile
pnpm format
pnpm check
pnpm pack --pack-destination artifacts
```

## 结构与规范

- `src/client/`：Harness 设置页、保存队列、媒体加载与壁纸渲染。
- `src/host/`：Connection Fetch 路由、输入校验、分块上传和本地存储。
- `src/shared/`：共享类型与常量。`locale/`：插件管理页的中英文名称、描述。
- UI 和 React 由 Harness 提供；`harness-ui.d.ts` 只声明本插件使用的接口，不复制组件实现。
- TypeScript strict、ESLint、Prettier；两空格缩进、100 列、分号和单引号，构建产物不压缩。

## 跨平台

Host 使用 Node.js 的 `path`、`fs` 和 `crypto`，文件存于 Harness 提供的 profile 下的 `dsh-harness-wallpaper/` 目录，不依赖 macOS 目录。媒体使用 UUID 文件名，上传原名只用于显示。客户端使用 Chromium / 现代浏览器的标准媒体 API，不使用系统专属窗口接口。

`.github/workflows/verify.yml` 在 Windows、macOS、Linux 上分别使用 Node.js 22 / 24 执行完整检查；配置存在不代表已经运行成功。桌面渲染、解码器和系统减少动态效果仍需各系统实机验证。

## npm 发布

`pnpm release` 依次运行 `npm login --auth-type=web`、`npm whoami`、`npm publish`，目标固定为 npm 官方 registry、公有访问。`prepack` 会执行完整检查；登录、身份检查或构建失败即终止。Windows 通过系统命令解释器运行固定的 npm 命令，拒绝额外参数。

`pnpm release --dry-run` 只执行 `npm pack --dry-run` 和相同的检查，不登录、不发布、不生成 tarball。版本号由维护者在发布前更新；npm 的双因素验证在终端或浏览器内完成，脚本不接收密码或令牌。

命令行为参见 npm 官方的 [login](https://docs.npmjs.com/cli/v11/commands/npm-login/) 与 [publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/) 文档。
