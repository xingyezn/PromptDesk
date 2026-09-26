# PromptDesk

部署于 GitHub Pages 的本地优先 Prompt 工作台。用 Project → Prompt → Version 管理提示词，用状态追踪构思、提交和完成过程。编辑器中的 Enter 只换行；应用没有向模型发送内容的功能。

依据《PromptDesk PRD V0.1》开发，当前版本为 `0.1.0-dev.4`。本地工作流与管理功能已逐批实现并通过合成测试，尚未完成全部发布验收和真实 GitHub Pages 部署。开发进度见 V0.1_TASKS，初始基线见 [开发预览验证记录](docs/qa/2026-09-26-development-preview.md)。

整体开发与最终产品计划见 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)，涵盖现有预览到完整本地工作台及正式发布的全部里程碑。新增的备份迁移和写作操作纳入原有计划，原有未完成任务继续保留。

目前可试用：创建/打开本地工作空间、项目与 Prompt、资料/标签/模型/备注、Markdown 自动保存、复制、状态/再次提交、版本查看和保护草稿的历史恢复、逻辑删除/恢复、下一条和排序、跨项目队列/全文搜索、临时草稿及转入项目。新增无标题弹窗创建、列表改状态、格式工具、可编辑设置、应用文件查看、ZIP 备份和复制迁移，见 [工作空间管理验证](docs/qa/2026-09-26-workspace-management.md) 和 [工作流验证](docs/qa/2026-09-26-planning-workflow.md)。不能将开发预览视为最终产品。

## 1. 文档导航

| 文件                             | 用途                                           |
| -------------------------------- | ---------------------------------------------- |
| [TECH_SPEC.md](TECH_SPEC.md)     | 架构、接口、读写流程、异常策略、依赖和部署配置 |
| [DATA_SCHEMA.md](DATA_SCHEMA.md) | 磁盘结构、字段、状态及版本规则、缓存结构       |
| [AGENTS.md](AGENTS.md)           | Codex 的开发约束、编码规范和禁止事项           |
| [V0.1_TASKS.md](V0.1_TASKS.md)   | 开发顺序、依赖、逐项验收和发布检查             |

字段及数据语义以 DATA_SCHEMA 为准，模块与接口以 TECH_SPEC 为准，执行顺序以任务清单为准。出现冲突时先统一文档再改代码，不能选择对实现最方便的一份。

## 2. V0.1 范围

- 创建、打开、关闭本地 Workspace；恢复最近目录句柄和重新授权。
- Project 创建、编辑、归档、删除；Prompt 创建、编辑、排序、标签、目标模型、状态及删除。
- Markdown 编辑、自动保存、字数和粗略 Token 估算、复制、下一条 Prompt。
- 明确保存版本、进入待提交/标记提交时创建检查点；查看和恢复历史版本。
- Flow/List 视图、Dashboard 待办队列、跨项目本地搜索、Scratchpad 临时草稿和转入项目。
- 设置、快捷键、损坏文件隔离、外部修改冲突提示和可恢复的删除。
- 用户追加范围：无标题弹窗创建、列表修改状态、列表/表格格式工具、可编辑工作空间设置、本地应用文件查看、ZIP 备份、复制迁移到新目录。

不包含账号、服务器、数据库服务、云同步、GitHub OAuth、LLM API、自动发送、自动读取模型对话、Kanban、版本 Diff 或完整 DAG。结果记录 UI 留到 V0.2；已有 result.md 原样保留。

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

## 4. 运行方式

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

`npm run test:e2e:production` 会构建 `/PromptDesk/` 子路径产物，再在生产预览运行主要浏览器流程（Windows 同样可设置 PLAYWRIGHT_CHANNEL）。可通过 VITE_BASE_PATH 覆盖 base；不运行第二遍规模测试。CI 和部署构建都加入该检查，工作流尚未在远端执行。

本地通过 localhost 打开；生产通过 HTTPS 打开，不能用双击 index.html 的方式运行。启动时检测安全上下文和目录选择能力；不支持时显示浏览器指引，不启用另一套虚拟 Workspace。目录选择必须由用户点击触发，句柄恢复后也可能需要重新授权，参见 [File System Access API 官方说明](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)。

## 5. Workspace 使用

1. 访问 Launcher，选择“创建新工作空间”或“打开已有工作空间”。
2. 创建时先检查目录。已有有效 Workspace 改为打开；非空目录必须显示初始化确认，只新增应用目录，不改动已有资料。存在冲突文件时拒绝初始化。
3. 打开时验证 `.promptdesk/workspace.json`、schemaVersion，再扫描项目和 Prompt 元数据。只有打开 Prompt 才读取正文与历史；全文搜索后台渐进建立索引。
4. 编辑后等待“已保存到工作空间”，需要冻结内容时点击“保存版本”。
5. 点击“复制 Prompt”后手动粘贴到模型产品；实际发送后点击“标记已提交”。复制不会改变状态。
6. 再次访问可打开最近 Workspace；权限失效时点击“重新授权”或重新选择目录。关闭 Workspace 不删除文件。

只有格式符合 DATA_SCHEMA 的文件夹属于已有 Workspace。普通 Markdown 目录不会被自动转换；缺少标识文件只能在用户确认后初始化，不能擅自导入、重写或删除资料。

浏览器不可靠地提供完整磁盘路径，界面使用 Workspace 名称和目录名。同一 Workspace 在不同电脑使用，前提是用户已自行复制整套文件；应用不负责同步。

设置中可查看规范应用文件、修改默认目标和自动保存、清除本应用缓存。ZIP 打包最多 5000 文件、32 MiB；下载完成请在浏览器下载列表确认，解压至空目录后重新打开。迁移需选择空目录并确认，完成复制和逐个校验后切换，原目录保留；根目录其他资料不随应用数据迁移，应用目录出现未知文件先停止以免遗漏。

工作台默认只搜索标题/项目/标签，点击“建立全文索引”后搜索正文；索引支持进度/取消，外部文件变化后点击刷新。临时草稿转入项目保留原文本并只读，可在“已转入”查看；转入目标是新 draft Prompt，没有自动版本。

## 6. GitHub Pages 部署（工作流已添加，尚未发布）

1. 建立应用仓库；真实 Workspace 放在仓库外。提交源代码、文档、lockfile 和工作流。
2. 仓库 Settings → Pages → Source 选 GitHub Actions。
3. 添加 TECH_SPEC 中的 `.github/workflows/deploy.yml`。main 推送后执行检查、构建、发布；PR 仅执行检查，不部署。
4. 项目站点配置 `VITE_BASE_PATH=/promptdesk/`（替换为仓库名）；用户站点或自定义域名配置 `/`。
5. 打开 `https://<user>.github.io/<repo>/#/`；在项目、编辑器、设置路由刷新并验证资源和导航。

当前 deploy.yml 预设仓库路径为 `/PromptDesk/`。创建远程仓库时如使用其他名称，修改此路径；当前没有配置远程 URL 或已上线地址。发布前必须完成原生能力及隐私验收。

必须只发布 dist/，不能上传仓库根目录或 Workspace。HashRouter 避免静态托管下的路径刷新 404；base 用于资源路径。配置依据 [Vite 静态部署文档](https://vite.dev/guide/static-deploy) 和 [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 7. 保存与恢复提示

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

## 8. 开发及发布完成条件

按 V0.1_TASKS 完成 P0、P1，P2 可后续处理。关键验收：清空 IndexedDB 后重新打开目录，项目、正文、历史版本、状态和 Scratchpad 均恢复；权限拒绝、故障中断与外部编辑不导致覆盖或静默丢失；Network 中没有业务内容外传；真实 Pages 地址可刷新并重新授权本地目录。

网站初次加载需要网络；V0.1 不承诺离线启动，也不加入 Service Worker。应用自身不上传业务数据，但用户选择的目录若受 OneDrive 等软件同步，其行为不受 PromptDesk 控制。
