# wx-kit v0.11.1 产品需求文档（迭代 PRD）

> 修复版（单项，源自 2026-09-15 发布当天另一台机器实录）。当前进度见 `ROADMAP.md`，验收以本文第 4 节为准。

## 1. 一句话定义

**从 Dock/Finder 启动的 wx-kit 必须和从终端启动的一样找得到 mocli——检测要探得到，执行要跑得动。**

## 2. 需求清单

### R1 · GUI 进程最小 PATH 下 mocli 误报「未检测到」

**用户目标**：任何一台机器、任何启动方式，只要装了 mocli，订阅页「墨问作者」tab 与设置页
「墨问集成」就应检测到它——不能因为 wx-kit 是从 Dock 启动的就恒报未安装（v0.11.0 发布当天
另一台机器实录：mocli 已装、终端 `which` 找得到，GUI 却恒报未检测到，墨问功能整个不可用）。

**根因**：macOS 规则——从 Dock/Finder 启动的 GUI 应用不加载 `~/.zshrc`，进程只拿系统最小
PATH（`/usr/bin:/bin:/usr/sbin:/sbin`）；mocli 装在 nvm/homebrew 等目录，只存在于 shell
配置里。原检测只跑 `which mocli`（继承 wx-kit 自身 PATH）→ GUI 场景必然落空。开发模式
`npm run dev` 从终端启动继承完整 PATH，故测试期物理上无法暴露。本机正式版 GUI 的
`settings.json` 留有 `mowenMocliPath: null` 残留，同证。

**隐藏的第二层**：找到 mocli 路径 ≠ 能执行。mocli 的 shebang 是 `#!/usr/bin/env node`，
`env` 需在 PATH 中解析到 node——GUI 进程同样没有。nvm/volta/homebrew 的 bin 目录里
mocli 与 node 同住，注入 mocli 所在目录进 PATH 可一并解决。

**方案**：

- 新增 `src/core/mowen/locate.ts` 三级探测链：① `which`/`where`（终端场景零开销）；
  ② 常见安装位纯文件系统检查（`/opt/homebrew/bin`、`/usr/local/bin`、`~/.volta/bin`、
  `~/.asdf/shims`、`~/.npm-global/bin`、nvm 最新 node 版本目录的 `bin/mocli`）；
  ③ login shell 兜底（`$SHELL -ilc 'command -v mocli'`，3 秒超时，输出取最后一个绝对路径行
  且须 exists 认可——.zshrc 可能打垃圾）。win32 保持 which-only：GUI 进程继承注册表 PATH，
  `where` 本来可靠。
- `runner.ts` 增 `injectPathDir`：把 mocli 所在目录 prepend 进 `process.env.PATH`
  （幂等），一次解决 mocli 与 node 两个可达性。**注入收口在 `detectMocli` 内部、
  version 探测之前**——注入晚了会让 GUI 场景 version 恒 null（打包产物实测：首版
  注入在 detect 返回后，GUI 启动检测只写回 path、version 恒 null）。
- GUI（`detectAndInject`）与 CLI（`mowenRunnerOf`）双入口统一走探测链，无需各自注入。

## 3.5 非目标

- 不引入 `fix-path` 类全局 PATH 改写方案（探测链只在 mocli 检出时注入其目录，影响面最小）。
- 不处理 Linux 桌面环境的 GUI PATH 差异（用户群 mac/win 为主；探测链对 linux 同样生效）。
- 不改 mocli 契约与业务调用（`metadata.ts` 等）。

## 4. 验收清单（逐条）

- [x] 探测链纯逻辑单测 11 条（which 命中零后续开销 / 固定安装位 / nvm 多版本取最新且容忍
      无 v 前缀与非法目录名 / login shell 垃圾输出取绝对路径行且 exists 认可 / 超时静默 /
      win32 不做 unix 探测 / HOME 缺失不崩 / 全落空 null）。
- [x] `injectPathDir` 单测（prepend、幂等、null 不动）。
- [x] **注入时序钉子**：安装位检出后、version runner 执行当刻 `process.env.PATH` 已含
      mocli 目录（单测捕获探测时刻的 PATH 断言）。
- [x] `npm test`（676 项含 13 条新增）、`npm run lint`、`npx tsc --noEmit`、GUI e2e 全绿。
- [x] 模拟 launchd 最小 PATH 环境（`env -i` + HOME + 最小 PATH）跑 CLI `mowen detect`：
      `installed:true`、`path` 为 nvm 绝对路径、`version` 与 `moUid` 非空（version/moUid
      依赖 `execFile('mocli')` 真实跑通，即 PATH 注入生效的证明）。
- [x] 同环境启动 GUI 主进程 10 秒内 `settings.json` 写入 `mowenMocliPath` 绝对路径**与
      `mowenMocliVersion`**（首版曾恒 null，时序修复后非空——打包产物二次验证）。
- [x] login shell 兜底通道真机验证：最小 env 下 `zsh -ilc 'command -v mocli'` 输出绝对路径。
- [x] 正常终端环境（完整 PATH）行为不变：which 一步命中，无额外探测开销。
