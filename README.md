> **V0.3 当前产品约束（2026-09-27）**：用户明确要求关闭 GitHub Pages，取消本地工作空间。Cloudflare Workers 同源托管 React 前端/API，D1 是所有账户项目、提示词、历史版本的权威来源。登录后进入个人空间，API 根据会话 userId 隔离；管理员仅管理账户，不默认读取其他人的正文。旧章节仅是 V0.1/V0.2 历史规格，不再限制当前云端实现。既有本地文件保持原样，不自动导入。任务见 V0.3_TASKS.md。

## 当前版本 V0.3

生产入口：https://promptdesk-worker.openedutools.workers.dev/

登录后打开个人空间，项目、提示词和历史版本保存于 Cloudflare D1。支持电脑和手机；不发送邮箱验证邮件。GitHub 仓库只保存代码，GitHub Pages 关闭。

开发：`npm ci`；`node scripts/dev-cloud.mjs`（独立合成测试环境 8789，启动清理该 test 库合成账户）。正常开发使用 `npm run build:worker`、本地 migration、`npm run worker:dev`，在 .dev.vars 配置私密 BetterAuth secret。`npm run dev` 只有前端，不能单独运行登录业务。

检查：`npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run test`、`npm run test:worker`、`npm run test:e2e`、`npm run build:worker`。部署：先 `wrangler d1 migrations apply DB --remote --env preview`，`wrangler deploy --env preview`，验收后对 production 执行相同流程。首次管理员初始化见 TECH_SPEC 当前章节。

以下为历史本地版本文档，保留作为演进记录。

# PromptDesk

部署于 GitHub Pages 的本地优先 Prompt 工作台。用 Project → Prompt → Version 管理提示词，以草稿、待提交和已完成规划下一步；完成项进入项目内的“已完成”分组。编辑器中的 Enter 只换行；当前已发布版本不会向模型发送内容。

依据《PromptDesk PRD V0.1》开发，当前公开预览版本为 `0.1.0-dev.5`（交互改版与 schema v2 已实现，V0.1 完整发布验收仍在进行）。应用已部署到 GitHub Pages；本地工作流与管理功能通过合成测试，原生目录授权仍待 Chrome/Edge 手测。开发进度见 V0.1_TASKS，初始基线见 [开发预览验证记录](docs/qa/2026-09-26-development-preview.md)。

整体开发计划见 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)；V0.2 新增手机/PWA、Cloudflare Workers 账户能力及用户主动触发的提示词优化，任务与安全边界见 [V0.2_TASKS.md](V0.2_TASKS.md)。账户支持邮箱+密码注册登录、注销和账户删除，认证数据保存在 Worker D1；当前不验证邮箱、不发送验证/重置邮件，忘记密码功能暂不可用。V0.1 尚未完成的任务继续保留。

目前可试用：创建/打开本地工作空间、项目与 Prompt、Markdown 自动保存、顶部复制、草稿/待提交/已完成状态、完成分组、优先级、拖拽排序、选区拆分、版本查看和保护草稿的历史恢复、逻辑删除/恢复、跨项目队列/全文搜索、临时草稿及转入项目。schema v1 首次打开会先预览状态映射，并要求逐条选择旧归档 Prompt 的新状态后才迁移。另有侧栏折叠、项目顶部重命名、格式工具、可编辑设置、应用文件查看、ZIP 备份和复制迁移。V0.2 已实现移动端紧凑列表、编辑字号、导航抽屉、可导出的本机手机速记、PWA 离线 shell 和 Worker 账户流程；Cloudflare Preview/Production 已部署，手机真机验收与 Worker 回滚演练仍待完成，详见 [V0.2-01](docs/qa/2026-09-27-v02-ux-mobile.md)、[V0.2-02](docs/qa/2026-09-27-v02-pwa-capture.md) 和 [V0.2_TASKS.md](V0.2_TASKS.md)。登录仅适用于 Worker origin；GitHub Pages 预览继续独立运行本地 Workspace 功能。

## 1. 文档导航

| 文件                             | 用途                                              |
| -------------------------------- | ------------------------------------------------- |
| [TECH_SPEC.md](TECH_SPEC.md)     | 架构、接口、读写流程、异常策略、依赖和部署配置    |
| [DATA_SCHEMA.md](DATA_SCHEMA.md) | 磁盘结构、字段、状态及版本规则、缓存结构          |
| [AGENTS.md](AGENTS.md)           | Codex 的开发约束、编码规范和禁止事项              |
| [V0.1_TASKS.md](V0.1_TASKS.md)   | 开发顺序、依赖、逐项验收和发布检查                |
| [V0.2_TASKS.md](V0.2_TASKS.md)   | 手机/PWA、Cloudflare Worker、账号与提示词优化计划 |

字段及数据语义以 DATA_SCHEMA 为准，模块与接口以 TECH_SPEC 为准，执行顺序以任务清单为准。出现冲突时先统一文档再改代码，不能选择对实现最方便的一份。

## 2. V0.1 范围

- 创建、打开、关闭本地 Workspace；恢复最近目录句柄和重新授权。
- Project 创建、编辑、归档、删除；Prompt 创建、编辑、优先级、拖拽顺序、拆分、标签、目标模型、三种状态及删除。
- Markdown 编辑、自动保存、字数和粗略 Token 估算、复制、下一条 Prompt。
- 明确保存版本、进入待提交/已完成时创建检查点；查看和恢复历史版本。
- Flow/List 视图、Dashboard 待办队列、跨项目本地搜索、Scratchpad 临时草稿和转入项目。
- 设置、快捷键、损坏文件隔离、外部修改冲突提示和可恢复的删除。
- 用户追加范围：无标题弹窗创建、列表修改状态、列表/表格格式工具、可编辑工作空间设置、本地应用文件查看、ZIP 备份、复制迁移到新目录。

V0.1 不包含账号、云同步、GitHub OAuth、LLM API、自动发送、自动读取模型对话、Kanban、版本 Diff 或完整 DAG。V0.2 Worker 账户只保存账户/认证数据，不接收 Workspace 内容；提示词优化仍未实现。

## 3. 技术及数据原则

React + TypeScript + Vite；HashRouter；Zustand 管理界面和编辑状态；Dexie 管理 IndexedDB；CodeMirror 6 编辑 Markdown；Zod 校验 JSON。具体依赖与初始化命令见 TECH_SPEC。

```text
GitHub 应用仓库 → Actions 构建 → dist/ → GitHub Pages
                                              │ 用户点击授权
                                              ▼
                                  File System Access API
                                              │
                                              ▼
用户本地 Workspace：Markdown 正文 + JSON 元数据 + 不可变版本
IndexedDB：目录句柄、缓存、搜索索引、界面偏好、未落盘草稿恢复副本
```

本地文件是已保存业务数据的唯一权威来源。IndexedDB 可以删除并重建；尚未写入文件的恢复草稿必须标记为“未保存”，不能冒充持久化成功。GitHub 只托管应用和合成测试数据，不能包含实际 Workspace。

## 4. Worker 本地开发

GitHub Pages 继续作为静态公开预览，部署时使用 `/PromptDesk/` base。Worker 拓扑使用单独 origin：Worker 同源提供 root base 的 SPA 和 `/api/*`，GitHub 继续托管源代码、CI 与 Pages 预览。登录 Cookie 以后只在 Worker origin 使用；Pages 不代理账户请求。Workspace 文件和手机速记仍为本机数据，不进入 D1。

```bash
npm run worker:migrations:local
npm run worker:dev
```

本地服务地址为 `http://127.0.0.1:8787`；健康接口返回 API 和 D1 schema 版本。运行 `npm run test:worker` 可在 Cloudflare Workers 运行时与本地 D1 上验证合成账户注册、登录、Secure Cookie、退出、账户删除、跨域拒绝及停用的邮件专属路由。Worker 构建使用 `npm run build:worker` 生成 root-base `dist/`；`npm run worker:check` 执行部署 dry-run。Cloudflare Preview：[promptdesk-preview.openedutools.workers.dev](https://promptdesk-preview.openedutools.workers.dev)；Production：[promptdesk-worker.openedutools.workers.dev](https://promptdesk-worker.openedutools.workers.dev)。真实邮箱验证请求返回 503 后，邮件验证和发送功能已按要求关闭；Preview/Production D1 migrations 已应用。不要在聊天、源码或 `VITE_*` 中放密钥。部署/验收记录见 [V0.2_TASKS.md](V0.2_TASKS.md)。

## 5. 运行方式

开发环境约定 Node.js 22.12 或更高的 22.x 版本，npm，桌面 Chrome/Edge。Node 版本选择依据 [Vite 环境要求](https://vite.dev/guide/)。依赖使用 package-lock.json 固定，日常与 CI 使用 npm ci。

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run preview
```

本地开发地址为 `http://127.0.0.1:5173/`。浏览器端到端测试首次运行需 `npx playwright install chromium`，然后 `npm run test:e2e`；Windows 已装 Edge 时可在 PowerShell 使用 `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e`。自动化使用合成目录，不替代原生目录授权验收。

`npm run test:e2e:production` 会构建 `/PromptDesk/` 子路径产物，再在生产预览运行主要浏览器流程（Windows 同样可设置 PLAYWRIGHT_CHANNEL）。可通过 VITE_BASE_PATH 覆盖 base；不运行第二遍规模测试。CI 和部署构建都执行该检查。

本地通过 localhost 打开；生产通过 HTTPS 打开，不能用双击 index.html 的方式运行。启动时检测安全上下文和目录选择能力；不支持时显示浏览器指引，不启用另一套虚拟 Workspace。目录选择必须由用户点击触发，句柄恢复后也可能需要重新授权，参见 [File System Access API 官方说明](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)。

## 6. Workspace 使用

1. 访问 Launcher，选择“创建新工作空间”或“打开已有工作空间”。
2. 创建时先检查目录。已有有效 Workspace 改为打开；非空目录必须显示初始化确认，只新增应用目录，不改动已有资料。存在冲突文件时拒绝初始化。
3. 打开时验证 `.promptdesk/workspace.json`、schemaVersion，再扫描项目和 Prompt 元数据。只有打开 Prompt 才读取正文与历史；全文搜索后台渐进建立索引。
4. 编辑后等待“已保存到工作空间”，需要冻结内容时点击“保存版本”。
5. 在编辑器顶部点击“复制 Prompt”后手动粘贴到模型产品。复制不会改变状态；应用不会自动发送。
6. 再次访问可打开最近 Workspace；权限失效时点击“重新授权”或重新选择目录。关闭 Workspace 不删除文件。

只有格式符合 DATA_SCHEMA 的文件夹属于已有 Workspace。普通 Markdown 目录不会被自动转换；缺少标识文件只能在用户确认后初始化，不能擅自导入、重写或删除资料。

浏览器不可靠地提供完整磁盘路径，界面使用 Workspace 名称和目录名。同一 Workspace 在不同电脑使用，前提是用户已自行复制整套文件；应用不负责同步。

设置中可查看规范应用文件、修改默认目标和自动保存、清除本应用缓存。ZIP 打包最多 5000 文件、32 MiB；下载完成请在浏览器下载列表确认，解压至空目录后重新打开。迁移需选择空目录并确认，完成复制和逐个校验后切换，原目录保留；根目录其他资料不随应用数据迁移，应用目录出现未知文件先停止以免遗漏。

工作台默认只搜索标题/项目/标签，点击“建立全文索引”后搜索正文；索引支持进度/取消，外部文件变化后点击刷新。临时草稿转入项目保留原文本并只读，可在“已转入”查看；转入目标是新 draft Prompt，没有自动版本。

## 7. GitHub Pages 部署

当前 dev.5 已部署到公开的 [PromptDesk GitHub 仓库](https://github.com/xingyezn/PromptDesk)，在线地址为 [https://xingyezn.github.io/PromptDesk/](https://xingyezn.github.io/PromptDesk/)。提交历史已清理后，[CI 运行](https://github.com/xingyezn/PromptDesk/actions/runs/36261616447) 和 [Pages 部署](https://github.com/xingyezn/PromptDesk/actions/runs/36261616464) 均成功。发布流程使用 `/PromptDesk/` 子路径，Pages 已配置为 GitHub Actions 并强制 HTTPS。

后续推送到 `main` 会执行检查后部署 `dist/`；Pull Request 只运行检查，不部署。若仓库名称改变，需同步修改 `.github/workflows/deploy.yml` 中的 `VITE_BASE_PATH`。真实 Workspace 必须留在仓库外；公开仓库只包含应用、文档和合成测试数据。

当前公开站点是 dev.5 开发预览，不代表 V0.1 发布验收已完成。已验证 HTTPS 首页、hash 路由入口和静态 JS/CSS 资源；真实桌面 Chrome/Edge 的原生目录授权、设备读写、重新授权和工作空间往返仍待手测，不能用合成 picker 测试替代。

必须只发布 dist/，不能上传仓库根目录或 Workspace。HashRouter 避免静态托管下的路径刷新 404；base 用于资源路径。配置依据 [Vite 静态部署文档](https://vite.dev/guide/static-deploy) 和 [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 8. 保存与恢复提示

| 场景                  | 行为                                                         |
| --------------------- | ------------------------------------------------------------ |
| 取消目录选择/拒绝授权 | 留在当前页面，保留编辑内容，可重试                           |
| 失去写权限            | 停止自动写入，保留未保存草稿，提供重新授权                   |
| 文件损坏              | 隔离受影响条目，能读取的正文可只读查看；不自动重建覆盖       |
| 外部程序修改文件      | 暂停写入，提供保留本地草稿和重新加载，不静默覆盖             |
| 浏览器缓存清空        | 重新选择目录恢复全部已落盘业务数据；偏好及未落盘副本可能丢失 |
| 版本高于应用支持      | 禁止写入，提示升级；不自动降级                               |
| IndexedDB 不可用      | 降级为当前会话直读文件，提示最近记录/草稿恢复不可用          |

删除使用逻辑删除，保留文件，可在“已删除”列表恢复；V0.1 不提供永久清空。归档与删除不同：归档仍可查看，编辑前需取消归档。不能承诺关闭浏览器瞬间一定完成异步保存，应等待落盘提示。

## 9. 开发及发布完成条件

按 V0.1_TASKS 完成 P0、P1，P2 可后续处理。关键验收：清空 IndexedDB 后重新打开目录，项目、正文、历史版本、状态和 Scratchpad 均恢复；权限拒绝、故障中断与外部编辑不导致覆盖或静默丢失；Network 中没有业务内容外传；真实 Pages 地址可刷新并重新授权本地目录。

网站初次加载需要网络；V0.1 不承诺离线启动，也不加入 Service Worker。应用自身不上传业务数据，但用户选择的目录若受 OneDrive 等软件同步，其行为不受 PromptDesk 控制。
