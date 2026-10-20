# 验证记录

2026-10-20 · macOS · Harness 0.2.1-rc.2 · dsh-harness-wallpaper v0.2.6

## 标识与存储

- 包名、Host 服务、客户端模块、RPC 接口、设置项标识、DOM/CSS 前缀和日志标识均使用 `dsh-harness-wallpaper`。
- 媒体与设置存于当前 profile 的 `dsh-harness-wallpaper/` 目录；设置文件为 `library.json`。
- README 和开发文档描述当前功能、安装方式、发布命令和平台限制。

## 自动化检查

- TypeScript strict、ESLint、Prettier、21 项测试及构建均通过。
- 测试覆盖动图与设置重启恢复、分块视频字节一致、媒体检测、无效输入与路径拒绝、并发保存、删除与清理、损坏元数据保护、RPC 信封校验、Host 路由与存储读写、资源卸载。
- 保存队列覆盖连续编辑合并、失败重试、旧请求隔离；发布脚本覆盖身份检查失败时中止、预演不发布和命令参数校验。

## 界面

- Harness 原生组件、中文名称与描述、SVG 图标、滑块与只读当前值。
- 滑轨使用 4 px 无边框细线、12 px 圆点及 Harness 浅色／深色主题 token。
- README 截图来自独立测试环境，未使用个人账号或媒体。

本机运行状态为「运行中」，Host 服务标识为 `dsh-harness-wallpaper`。媒体与设置逐文件校验一致，壁纸正常加载。

## 平台边界

macOS 桌面版及 Web 界面已实测。Windows / Linux 未实机验证；三系统 × Node.js 22 / 24 的 GitHub Actions 配置尚未在远程仓库执行。

百 MiB 文件性能、其他系统的媒体解码与减少动态效果开关仍需实机验证。实际 npm 发布及账号权限不在预演范围内。
