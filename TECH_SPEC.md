# PromptDesk V0.1 技术规格

## 追加规格：整体计划及工作空间管理（2026-09-26）

用户明确追加的范围见 DEVELOPMENT_PLAN。包管理新增固定版本 fflate 0.8.3（本地 ZIP）及 remark-gfm 4.0.1（Markdown 表格/任务列表预览）；锁定 package-lock，不使用 CDN。参见 [fflate 文档](https://github.com/101arrowz/fflate)、[remark-gfm 文档](https://github.com/remarkjs/remark-gfm)。本节覆盖下文旧接口中的必填创建标题限制及手工复制目录的范围说明。

- `createPrompt(projectId, title?)` 默认“未命名提示词”，成功落盘后直接打开正文，标题可后改。
- `transitionStoredPrompt(projectId, promptId, status)` 先校验列表元数据指纹，读取该 Prompt 磁盘正文，再走同一个 checkpoint。UI 先 flush 当前草稿；目标不同时不改变当前选中 Prompt。失败不提前修改列表状态。
- CodeMirror 使用 Markdown keymap 续写列表；工具栏对选择内容做纯文本格式变换，支持标题/粗体/列表/任务/引用/代码/表格（制表符转列）。Ctrl/Cmd+Enter 不提交，IME 不触发业务；预览依旧关闭 raw HTML 和图片，安全链接仅用户点击打开。
- `updateSettings({name,defaultTarget,autosaveEnabled,autosaveDelayMs})` 显式白名单；同一队列事务写 settings.json 与 workspace.json，校验后更新 view。自动保存关闭仍有手动草稿按钮及未保存反馈。
- `files()/readLocalFile(path)` 只读应用文件的相对路径与 UTF-8 内容；FSA 在 filesystem 层。网页不能可靠获取绝对路径或打开系统文件管理器，UI 不声称具备这些能力。
- `snapshot()` 在 Workspace 写队列中枚举并验证规范内应用文件（含逻辑删除/归档/完整版本及规范可选 README/result）；根目录其他资料不枚举正文。应用目录内的未知条目阻止转移，避免静默漏备份。
- 快照最多 5000 个文件、总 32 MiB、单文件仍 5 MiB；按 UTF-8 文本采集，逐个 hash，前后重复核对文件集合和指纹。不承诺 OS 原子快照，外部程序仍可能在最后校验后改动文件。
- `exportArchive()` 校验快照后本地生成 ZIP Blob，由浏览器下载。反馈为“下载已生成”，不把下载开始当作用户设备已可靠保存。ZIP 内根布局直接是规范目录；恢复为用户解压至空目录，再打开已有 Workspace。没有 ZIP 上传/直接导入。
- `prepareMigration()` 必须在用户点击调用栈中启动目录 picker，目标必须空目录，记录 sessionId 和源快照；弹窗展示范围，再 `migrate()`。
- 迁移使用目标 Journal 的 initialize 操作（根 manifest 最后落盘），不复制源 pending；规范可选 README.md/result.md 仅作为转移目标写入白名单。目标写入 expected absent、close 后重读、完成核对源/目标快照。目标完整后新 Runtime 打开并校验，保留同 workspaceId 及同源锁，切换会话和 recentKey，原目录始终保留。
- 迁移准备后源变化/目标不空/写失败/权限撤销则不切换；失败目标保留恢复日志，通过打开目标完成或回退。准备记录未成 manifest 时只做诊断，不假称可自动恢复。全量复制没有原子 move/rename 假设，不删除源文件，不自动重试覆盖。

转移 helper 接收 FileSystemPort，可在合成适配器验证；service 不依赖 React/Zustand。缓存副本不加入 ZIP/迁移，不从缓存重放正文；浏览器授权和系统设备 IO 仍需真机验收。

## 当前工作流实现补充（2026-09-26）

- 工程目前由 `WorkspaceController` 提供 Result 边界，`WorkspaceRuntime` 聚合项目/Prompt/版本/Scratchpad use case，共享一个 Journal。下文的拆分接口仍是目标端口描述，不能把尚未拆成独立类误写为已完成；组件通过 controller/run 调用，服务不依赖 UI store。
- `createNext` 和完整 ID 列表 `reorder` 在单一事务内创建/调整 order；字段 patch 白名单增加项目 description/tags。项目或 Prompt 归档后正文/资料不可编辑，项目级结构调整仅维持 order 连续，不改归档内容、状态或历史。
- Prompt 元数据创建使用纯领域工厂；parent 同项目引用及循环、active order 连续关系校验在加载/完整快照中执行。已损坏文件造成的排序缺口不会再次把正常同级条目标为损坏。规范内版本仍按需 hash 验证。
- Scratchpad 元数据随导航扫描；创建/打开/保存/逻辑删除独立 use case。转入在一个 Journal 中核对源 current.md，创建目标 current/meta，最后提交源 transferredTo；源保留且只读。重复转入验证已有目标并返回原引用，目标缺失不再创建。
- Scratchpad 编辑器有 editSeq/persistedSeq、会话/实体校验、防抖、恢复副本和导航 flush 注册；缓存失效时已落盘草稿仍可重开。标题未落盘的恢复语义与正文区分：缓存恢复副本保存正文，标题应等待设置事务成功，不承诺瞬间关闭恢复未保存标题。
- Dashboard 增加跨项目队列、字段 AND 筛选、`status/model/tag/project` 查询前缀与未知筛选反馈。用户点击建立/刷新全文索引；正文逐条从当前磁盘读取，不阻挡首次导航加载去等全文。每十条更新进度并让出界面，AbortSignal 和 runtime 身份保护切换/取消后的回调；取消后明确显示结果不完整。
- 搜索缓存记录 recentKey、revision、正文 hash；当前不复用未核对磁盘的正文缓存，刷新从磁盘重建。业务变化使缓存索引失效。界面未打开新索引时只搜索元数据，并有常驻说明；缓存失败不阻止搜索直读。
- `externalChanges` 仅检查根/设置及当前打开 Prompt 的少量指纹，窗口 focus 不批量读取所有正文，也不更新写基线。所有业务提交另核对根、设置与相关父项目，防止外部替换工作空间身份或设置后继续按旧会话写入。
- 冲突重新加载提供确认并保留原草稿在当前会话可查看/复制；`refreshPending` 不重置冲突基线。设置可显式重新读取目录。重新授权只能用户点击触发，不自动循环；保留原生权限验收。
- 本应用缓存清除需应用内确认，清除最近记录、搜索及恢复副本，不删除本地文件。UI 偏好/完整诊断及其他余项仍由 V0.1_TASKS 追踪。

状态：开发实施基线。日期：2026-09-26。数据字段、状态枚举及文件路径引用 [DATA_SCHEMA.md](DATA_SCHEMA.md)。本文的崩溃恢复和冲突策略是对 PRD 的工程补充；不新增云端功能。

## 1. 固定决策

| 事项       | 决策                                                                  |
| ---------- | --------------------------------------------------------------------- |
| 产品运行时 | 浏览器纯前端 React + TypeScript + Vite，无服务端依赖                  |
| 部署       | GitHub Pages；main 检查通过后 Actions 发布 dist/                      |
| 路由       | react-router-dom HashRouter；不依赖服务端 rewrite                     |
| 文件访问   | 用户授权目录的 File System Access API；只支持经验证的桌面 Chrome/Edge |
| 文件格式   | UTF-8 Markdown + JSON；本地文件为权威来源                             |
| 缓存       | Dexie/IndexedDB，保存 handles、索引、偏好与恢复副本                   |
| 编辑器     | CodeMirror 6 Markdown，纯文本为核心，可安全预览                       |
| 状态       | Zustand 仅管理运行时/UI 状态，不持久化业务对象代替文件                |
| 校验       | Zod 运行时校验；从 schema 推导 TypeScript 类型                        |
| 并发       | 每 Workspace 单写入队列；同源使用 Web Locks；外部写入用内容指纹检测   |
| 删除       | deletedAt 逻辑删除，文件原地保留；不依赖目录 move/rename              |

## 2. 分层与目录

```text
仓库/
  README.md / TECH_SPEC.md / DATA_SCHEMA.md / AGENTS.md / V0.1_TASKS.md
  package.json / package-lock.json / index.html
  vite.config.ts / tsconfig*.json / eslint.config.js
  .gitignore / .nvmrc
  .github/workflows/{ci,deploy}.yml
  public/                         # 仅应用静态资源
  src/
    main.tsx
    app/{App,router,providers}.tsx
    components/                  # 通用按钮、弹窗、保存指示、错误边界
    features/
      workspace/                 # Launcher、授权、关闭/切换
      dashboard/
      projects/
      prompts/                   # Flow/List、编辑器、字段、下一条
      versions/
      search/
      scratchpad/
      settings/
    services/
      filesystem/                # NativeFileSystemAdapter、路径校验
      cache/                     # Dexie schema、失效与降级
      transactions/              # 串行队列、pending、恢复、指纹
      workspace/                 # 加载/初始化/权限状态编排
      project/
      prompt/
      version/
      scratchpad/
      search/
      clipboard/
    domain/{schemas,status,version-policy,ordering}.ts
    stores/{workspace,editor,ui}.ts
    hooks/                       # 订阅、快捷键、防误关闭
    types/                       # 端口、错误、运行时 view models
    utils/                       # 时间、hash、粗略估算
    styles/
  tests/
    unit/                        # 规则和 schema
    integration/                 # 内存文件适配器、故障注入
    e2e/                         # UI 自动化，不冒充原生授权测试
    fixtures/synthetic/          # 只允许合成数据
  docs/qa/                       # 手动验收结果，不能含真实内容
```

调用方向：UI → use case/service → domain + FileSystemPort/CachePort。domain 不依赖 React、Zustand、Dexie 或浏览器 API。filesystem 不理解业务状态；transactions 只处理文件集合；业务 service 决定何时版本化与变更字段。services 不导入 stores，返回结果由控制器更新 stores，避免循环依赖。

第一批实现细化：WorkspaceController 为 UI 的公共入口并返回 Result<T>，内部 FileSystemPort/WorkspaceRuntime 抛出规范化 AppFault，由 controller/execute 统一转换为 Result。内部签名见 src/types/filesystem.ts，避免每一层重复解包。当前以一个 WorkspaceRuntime 编排核心纵向链路；后续按功能拆分 Project/Prompt/Version 服务时继续共用 Journal，不另建写入路径。

UI 不持有原生目录句柄，只有 sessionId；句柄由 WorkspaceService/适配器持有。所有磁盘写入均经过事务协调器，UI、hooks、domain 禁止直接调用文件 API。缓存实现不得调用网络。

## 3. 接口边界

下列为必须实现的端口契约；类型来源为 DATA_SCHEMA。命名可以在实现中细化，但行为不得省略。

```ts
type RelativePath = readonly string[]; // 每段校验，不能接收绝对路径
type Fingerprint = { sha256: string; size: number; lastModified: number };
type ExpectedFile = { kind: 'absent' } | { kind: 'present'; fingerprint: Fingerprint };
type AppErrorCode =
  | 'UNSUPPORTED'
  | 'CANCELLED'
  | 'PERMISSION_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'SCHEMA_TOO_NEW'
  | 'CONFLICT'
  | 'BUSY'
  | 'WRITE_FAILED'
  | 'CACHE_UNAVAILABLE'
  | 'RECOVERY_REQUIRED'
  | 'PATH_INVALID';
type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };
interface AppError {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  relativePath?: string;
} // 不暴露正文、真实路径或未经处理的异常文本
interface FileSystemPort {
  pickDirectory(mode: 'read' | 'readwrite'): Promise<Result<DirectoryRef>>;
  queryPermission(root: DirectoryRef, mode: 'read' | 'readwrite'): Promise<PermissionState>;
  requestPermission(root: DirectoryRef, mode: 'read' | 'readwrite'): Promise<PermissionState>;
  readText(
    root: DirectoryRef,
    path: RelativePath,
  ): Promise<Result<{ text: string; fingerprint: Fingerprint }>>;
  list(root: DirectoryRef, path: RelativePath): Promise<Result<Entry[]>>;
  ensureDirectory(root: DirectoryRef, path: RelativePath): Promise<Result<void>>;
  writeText(
    root: DirectoryRef,
    path: RelativePath,
    text: string,
    expected: ExpectedFile,
  ): Promise<Result<Fingerprint>>;
  removeGeneratedFile(
    root: DirectoryRef,
    path: RelativePath,
    expected: Fingerprint,
  ): Promise<Result<void>>;
  cleanupPending(root: DirectoryRef, operationId: string): Promise<Result<void>>;
}
interface TransactionPort {
  run(sessionId: string, change: ChangeSet): Promise<Result<CommitReceipt>>;
  inspectPending(sessionId: string): Promise<Result<RecoveryReport>>;
  recover(
    sessionId: string,
    operationId: string,
    choice: 'finish' | 'rollback',
  ): Promise<Result<CommitReceipt>>;
  drain(sessionId: string): Promise<Result<void>>;
}
interface WorkspaceService {
  selectExisting(): Promise<Result<WorkspaceSession>>;
  selectForCreation(): Promise<Result<CreationPlan>>;
  initialize(plan: CreationPlan, input: CreateWorkspaceInput): Promise<Result<WorkspaceSession>>;
  openRecent(recentKey: string): Promise<Result<WorkspaceSession>>;
  authorize(sessionId: string): Promise<Result<void>>;
  refresh(sessionId: string): Promise<Result<LoadReport>>;
  close(sessionId: string): Promise<Result<void>>;
  previewSchemaMigration(): Promise<Result<SchemaMigrationPreview>>;
  confirmSchemaMigration(choices: ArchivedPromptChoices): Promise<Result<WorkspaceSession>>;
  recoverSchemaMigration(choice: 'finish' | 'rollback'): Promise<Result<MigrationRecoveryResult>>;
}
interface ProjectService {
  list(sessionId: string): Promise<Result<ProjectSummary[]>>;
  create(sessionId: string, input: CreateProjectInput): Promise<Result<Project>>;
  update(sessionId: string, id: string, patch: ProjectPatch): Promise<Result<Project>>;
  setArchived(sessionId: string, id: string, archived: boolean): Promise<Result<Project>>;
  setDeleted(sessionId: string, id: string, deleted: boolean): Promise<Result<Project>>;
}
type PromptRef = { projectId: string; promptId: string };
interface PromptService {
  create(
    sessionId: string,
    projectId: string,
    input: CreatePromptInput,
  ): Promise<Result<PromptMeta>>;
  open(sessionId: string, ref: PromptRef): Promise<Result<PromptDocument>>;
  saveDraft(
    sessionId: string,
    ref: PromptRef,
    body: string,
    editSeq: number,
  ): Promise<Result<SaveReceipt>>;
  update(sessionId: string, ref: PromptRef, patch: PromptPatch): Promise<Result<PromptMeta>>;
  transition(
    sessionId: string,
    ref: PromptRef,
    next: PromptStatus,
    body: string,
  ): Promise<Result<PromptMeta>>;
  createNext(sessionId: string, ref: PromptRef): Promise<Result<PromptMeta>>;
  split(
    sessionId: string,
    ref: PromptRef,
    originalBody: string,
    newPrompt: { title: string; body: string },
  ): Promise<Result<PromptMeta>>;
  reorder(sessionId: string, projectId: string, ids: string[]): Promise<Result<void>>;
  setDeleted(sessionId: string, ref: PromptRef, deleted: boolean): Promise<Result<PromptMeta>>;
}
interface VersionService {
  checkpoint(
    sessionId: string,
    ref: PromptRef,
    body: string,
    reason: VersionReason,
    note?: string,
  ): Promise<Result<VersionMeta>>;
  read(sessionId: string, ref: PromptRef, number: number): Promise<Result<string>>;
  restore(sessionId: string, ref: PromptRef, number: number): Promise<Result<PromptMeta>>;
}
interface SearchService {
  rebuild(sessionId: string, signal: AbortSignal): Promise<Result<void>>;
  search(sessionId: string, query: SearchQuery): Promise<Result<SearchResult>>;
  invalidate(sessionId: string, ref?: PromptRef): Promise<void>;
}
interface ScratchpadService {
  create(sessionId: string, title: string): Promise<Result<ScratchpadMeta>>;
  open(sessionId: string, id: string): Promise<Result<ScratchpadDocument>>;
  save(sessionId: string, id: string, title: string, body: string): Promise<Result<void>>;
  transfer(sessionId: string, id: string, projectId: string): Promise<Result<PromptRef>>;
  setDeleted(sessionId: string, id: string, deleted: boolean): Promise<Result<void>>;
}
interface CachePort {
  rememberWorkspace(record: RecentWorkspaceRecord): Promise<Result<void>>;
  putRecoveryDraft(record: RecoveryDraft): Promise<Result<void>>;
  getRecoveryDrafts(workspaceId: string): Promise<Result<RecoveryDraft[]>>;
  invalidateWorkspace(workspaceId: string): Promise<void>;
}
```

```ts
type ArchivedPromptChoices = Record<string, PromptStatus>;
interface SchemaMigrationPreview {
  workspaceId: string;
  workspaceName: string;
  counts: Record<string, number>;
  archivedPrompts: { projectId: string; promptId: string; title: string }[];
  sourceFingerprint: string;
}
type MigrationRecoveryResult =
  { kind: 'opened'; view: WorkspaceSession } | { kind: 'preview'; preview: SchemaMigrationPreview };
```

状态迁移、拆分与排序仍由 WorkspaceRuntime 的同一写队列和 Journal 提交；`PromptPatch` 白名单包含 `priority`，绝不包含 id、order、statusHistory、schemaVersion 或 versions。拆分在 UI 只负责从编辑器选区构造保留正文和新正文，确认后由 service 一次写入两条正文/元数据、父子关联和 order 调整。迁移预览 DTO 只携带状态计数、待选择 Prompt 标识/标题和无正文的源指纹；句柄只保留在适配器/controller。

DirectoryRef、ChangeSet、加载摘要、输入 DTO 均在实现时补全：DirectoryRef 为适配器内注册的句柄引用；ChangeSet 为 operationId、相对路径、before/after 内容和 expected 指纹集合；CommitReceipt 为 operationId 与各文件新指纹。所有 patch 使用字段白名单，不能让 UI 修改 id、slug、schemaVersion、版本编号或历史数组。removeGeneratedFile 只允许事务回退删除本次创建且 hash 匹配的应用文件；cleanupPending 只处理经验证的该 operation 暂存目录，二者不得作为 UI 删除接口。

Permission 调用与目录选择必须从明确点击入口进入。点击前预先读取 recent 句柄；不要在 await 网络或异步准备后才启动需要用户激活的 API。授权策略依据 [Chrome 官方文件访问文档](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)。

## 4. Workspace 生命周期与加载

运行状态：`closed → selecting → validating → loading → open`；旁路状态：`permission-required / readonly / recovery-required / failed`。取消选择回到原状态，不能清空当前编辑器。

创建：检查根目录 → 输出 CreationPlan（拟新增路径、冲突、非空提示）→ 用户确认 → 创建数据目录 → 最后写 workspace.json 作为初始化完成标识。若中断，保留已有文件，显示初始化未完成，不能再次盲写。存在同名 `.promptdesk`、`projects` 或 `scratchpad` 且含不明数据时拒绝初始化，建议选择空目录。不得递归扫描普通用户资料。

打开：读取并校验 workspace.json → 获取同源写入锁 → 检查 pending → 读取设置 → 扫描已知 projects 下一级和 prompts 下一级 → 校验 metadata、构建导航 → 可进入主界面 → 后台读取 current.md 建立全文搜索。每次打开 Prompt 从文件重读，缓存仅用来加速界面。版本正文仅按需读；限制并发读取为 4，可取消旧 Workspace 的所有加载和索引任务。根标识缺失但发现已知 pending 目录中的合法 initialize 记录时，使用该计划 ID 获取锁，提供显式初始化恢复，不能重新分配 ID 再初始化；无合法恢复证据时拒绝接管残留目录。

单项目或 Prompt 损坏输出 LoadReport.issues，不阻止其他正常项目。损坏条目显示只读入口和相对位置，不擅自删除。根 manifest 损坏则停止正式打开，允许诊断只读，不初始化覆盖。

Recent 恢复：queryPermission(readwrite) granted 才进入可写；prompt 提供点击授权；denied 提供重新选择。只读权限有效但写权限拒绝时可显式进入只读。每次实际读取/写入都处理权限异常，启动时 granted 不等于永久有效。句柄失效可重新选择，重新校验 manifest，使用 isSameEntry（适用时）区分同目录和拷贝目录。相同 workspaceId 不同句柄不自动替换；显示副本选择并以 recentKey 分别保存。

当前 Workspace schema 为 v2。v1 打开时先取写锁并校验只读迁移预览；显示状态映射及旧 archived Prompt 的逐项选择，确认后经 pending migration 事务升级。取消不写盘；确认中断保留恢复记录。高于 v2 的 schema 拒绝写入，不自动降级。关闭/切换先暂停编辑、flush 防抖、drain 队列。失败时保留原会话，让用户重试或显式保留未保存副本后离开；旧会话回调不能污染新会话。

## 5. 自动保存、事务与崩溃恢复

### 5.1 草稿保存

默认 debounce 800ms，设置范围 500–2000ms。编辑器状态保存 `body / editSeq / persistedSeq / baseFingerprint / saveState`。每次输入增加 editSeq，先更新内存，可将恢复副本写 IndexedDB；自动保存只更新 current.md 和 updatedAt/revision，不增加版本。

写入必须按 Workspace 串行；同一 Prompt 可合并尚未开始的自动保存，只保留最新内容。已开始写入不取消，中途新输入产生下次写入。只有确认对应 editSeq 的整个事务落盘后才能更新 persistedSeq；旧保存成功时若存在更新输入仍显示“有未保存修改”。取消自动保存后显示“未保存”，提供“保存草稿”，Ctrl/Cmd+S 仍为“保存版本”。

页面 visibilitychange 可以尽力 flush；beforeunload 仅用于提示，不把异步保存当成可靠保证。路由跳转、切换 Prompt、恢复版本、删除和标记状态前主动 flush；写失败不丢编辑器内容。Clipboard 复制当前编辑器文本，即使未保存也可复制，但明确保留未保存状态。

### 5.2 文件写入

使用 createWritable → write → close；只有 close 成功并重新读取校验 hash 才算文件成功。失败尽力 abort，不能直接返回“已保存”。接口不假定有可用的目录 rename，也不把多个文件写入称为原子操作。[MDN 写入说明](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable) 是单文件写入行为依据。

每次写入前检查 expected：已有文件比较新读取的 SHA-256，缺失文件确认不存在；元数据还比较 revision。size/lastModified 是快筛，不能作为唯一冲突依据。外部编辑可能恰好发生在检查后，Web API 不提供跨进程 compare-and-swap，因此仍要求用户避免同时编辑，并在提交后重读校验；这是明确的并发限制。

### 5.3 多文件事务协议

V0.1 需要最小可恢复协议，而非声称全盘原子性：

1. 串行队列中校验输入、权限、所有 before 指纹及版本文件不存在；生成 operationId。
2. 在 `.promptdesk/pending/<operationId>/` 保存每个被改变文件的 before/after UTF-8 副本；校验副本 hash，最后写 manifest.json。before 不存在用 null 标记。manifest 持久化完成前禁止改业务文件。
3. 写正文/新版本文件，再写业务元数据。各操作的最终元数据为 commit marker；包含 lastOperationId。项目创建最后写 project.json；Prompt 创建最后写 meta.json；Workspace 初始化最后写 workspace.json；转入项目最后更新 Scratchpad 的 transferredTo。
4. 写完所有目标并验证 after hash 后，将 manifest.phase 改为 committed，更新内存和缓存；完成后移除 pending 副本。清理失败不能把已成功保存报告为数据未保存；保留并显示已验证的 pending 记录，允许当前会话或下次打开后继续恢复/清理。
5. 任一步失败：保留 pending 与编辑器，返回 RECOVERY_REQUIRED/WRITE_FAILED，暂停相关写入，不继续提交状态或推进版本号。

打开时发现 pending：如果全部目标与 after hash 一致，作为已完成提交验证后清理；全部与 before 一致，作为未提交操作处理；混合 before/after 提供“完成保存”或“回退本次保存”，先展示受影响路径。phase 已为 committed 的操作仅允许清理，不允许回滚已确认成功的保存。任一目标既不等于 before 也不等于 after，视为外部冲突，只读诊断，不自动完成/回退。恢复只写匹配 before/after 的文件。rollback 对原本不存在的文件只允许移除 hash 精确等于 after 的应用生成文件，不能递归删除业务目录。初始化回退后允许保留空的应用目录；再次初始化先验证它们确为空且不含未知文件，再展示计划让用户确认。

同会话读取与刷新必须等待当前队列提交或失败，不能在多文件事务半途中建立索引。只读第二窗口若发现另一个窗口持锁且存在 pending，只显示“另一个窗口正在保存”，不尝试恢复或读取受影响条目；收到提交通知后重读。只有获得写锁才能执行恢复/清理，不能把活动事务误判为崩溃遗留。

没有 manifest 的 pending 子目录属于未准备完的 staging，业务文件应未触碰；只读检查后可清理这类应用临时副本。所有恢复结果均可重复执行，不能再产生重复版本。transferredTo 和 operationId 保证 Scratchpad 转入重试不重复创建。

## 6. 状态及版本操作

所有状态按钮调用统一状态 use case；当前值仅 `draft | ready | completed`，允许人工任意跳转。待办 checkbox 直接切换 completed，并分组展示完成项。进入 ready/completed 前正文非空，检查点与状态经同一事务提交；失败时状态保持原值。状态副作用在 domain policy/service 中集中实现，复制与状态完全独立。

显式保存版本冻结当前正文；正文与最新版本完全相同则复用，不制造重复。同状态但正文有变化时可创建新检查点，不追加重复状态事件。恢复不覆盖任何历史文件：先保存当前草稿检查点（若变化），再创建恢复检查点，写 current.md；状态保持原值，提示用户自行决定是否重开任务。规则详见 DATA_SCHEMA。

Project/Prompt 删除前应用内确认，事务写 deletedAt，不搬动文件。恢复清除 deletedAt；Project 删除后其 Prompt 全部隐藏但不逐条改状态，恢复 Project 保留各 Prompt 原来的删除标记。归档 Project 对子 Prompt 只读；不级联改 Prompt.status。

## 7. 冲突与同源多窗口

编辑会话打开后保存基线；focus、重新打开、点击刷新、写前重读指纹。检测到 current.md/meta.json 外部变化时暂停该 Prompt 自动保存，保留内存草稿。提供：保存恢复副本并重新加载磁盘；复制未保存内容供用户保留。V0.1 不提供直接强制覆盖按钮；用户重读磁盘后可自行合并内容，再基于新指纹正常保存。未保存恢复副本不得在“重新加载”时删除。

持有 `navigator.locks` 的 `promptdesk:workspace:<workspaceId>` exclusive 锁直到关闭；ifAvailable 获取失败则只读，提供刷新/重试。BroadcastChannel 仅广播 id、revision、操作类型，不发正文。Web Locks 仅协调同源浏览器上下文，不能锁外部编辑器、其他浏览器或电脑，参见 [MDN Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)。若不可用，显示并发保护不可用提示，仍单窗口使用与指纹检查，不承诺跨窗口一致性。

## 8. 缓存、索引和隐私

缓存键必须含 workspaceId；sessionId/目录实例区分相同 ID 的不同副本。复制目录打开时清除该 workspaceId 下旧业务缓存，再按磁盘建立，不能跨副本重放恢复草稿。目录句柄用结构化克隆存 IndexedDB，不 JSON.stringify。DB schema 版本与 workspace schemaVersion 独立升级。

SearchService：初始索引标题、项目名、标签；后台读当前正文，不读历史版本；查询包含正文时索引未完成要显示“正在索引，结果可能不完整”。解析 status/model/tag/project 筛选；普通词不区分大小写、按子串匹配；过滤条件 AND。删除/归档默认排除，可明确包含。索引每次打开验证/重建，保存后更新，冲突后失效。切换 Workspace 必须清空旧结果与任务。

允许 IndexedDB 未保存恢复副本，但打开时必须先读取磁盘并核对 workspaceId、目录实例与基线 hash，用户选择恢复后才写盘，不能无提示回放。成功提交后按 editSeq 清除对应副本；更高 editSeq 副本不能误删。清空缓存不影响文件。DB 初始化/配额失败用当前会话直读模式，明确恢复能力不可用。

应用不调用业务网络接口；无 analytics、远程字体、远程错误上报、GitHub SDK、LLM SDK。react-markdown 不启用 raw HTML；预览禁用所有远程图片（含 Markdown、HTML、CSS、SVG 引用），链接只允许安全 http(s)，用户明确点击才新窗口打开，noreferrer/noopener；禁止 javascript/data 执行。V0.1 不提供本地附件自动解析。自身生成的代码/文本只显示，不执行。

生产 index.html 的 meta CSP 建议 `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'`；CodeMirror 需要动态样式，允许 inline style；开发环境单独放行 Vite HMR。不能声称 meta CSP 等同服务器安全头，也不能阻止其他同源应用访问 IndexedDB。GitHub 项目 Pages 常共享 user.github.io origin，敏感使用建议单独受控域名；应用自身保证不跨项目缓存读取及不上传，不能声称浏览器缓存具备密码学隔离。

## 9. 错误映射与交互

| 底层事件                     | 应用结果                           | 用户处理                            |
| ---------------------------- | ---------------------------------- | ----------------------------------- |
| picker AbortError            | CANCELLED                          | 非致命，返回原界面                  |
| SecurityError / 非安全上下文 | UNSUPPORTED 或 PERMISSION_REQUIRED | 提示 HTTPS/点击授权，不反复自动弹窗 |
| NotAllowedError              | PERMISSION_DENIED                  | 暂停保存，保留草稿、重新授权        |
| NotFoundError                | NOT_FOUND                          | 重选目录/刷新，只读正文可保留       |
| JSON.parse/Zod 失败          | INVALID_JSON/INVALID_SCHEMA        | 隔离条目、显示定位，不覆盖          |
| 高 schemaVersion             | SCHEMA_TOO_NEW                     | 停止写入，升级指引                  |
| 指纹或 revision 不同         | CONFLICT                           | 保留双方，暂停自动保存              |
| 写盘/设备异常                | WRITE_FAILED                       | 未保存提示、重试、恢复副本          |
| pending 未完成               | RECOVERY_REQUIRED                  | 进入恢复流程，不能继续普通编辑      |
| IndexedDB 配额/克隆失败      | CACHE_UNAVAILABLE                  | 文件直读降级，提示缓存不可用        |

保存状态区和可重试动作必须在界面显示，不能只记录 Console。日志仅错误码、operationId、合成/脱敏相对路径；不记录正文、标签、真实标题和句柄。Promise 必须捕获，ErrorBoundary 处理渲染异常但不能替代业务错误。

## 10. 页面及交互标准

Launcher、Dashboard、Project Workspace（三栏）、Prompt Editor、Version History、Settings；Scratchpad 和已删除列表可作为主界面内视图。1024px 及以上完整编辑，窄屏折叠栏，手机基础查看。Flow 为按 order 排列的线性列表，parent 用文本标识，不实现 DAG。

Dashboard 根据文件元数据统计 draft/ready/completed，排除归档/删除项目与 Prompt。项目 Prompt 列表默认显示未完成项，completed 在单独分组；拖拽写入 order，priority 独立显示且不重排用户指定次序。“下一条”优先取 ready，再取 draft。最近项目来自 UI 偏好，不改业务排序。侧栏折叠状态属于 IndexedDB UI preference。

快捷键：Ctrl/Cmd+S 保存版本；Ctrl/Cmd+Shift+C 复制；Ctrl/Cmd+K 搜索；Ctrl/Cmd+N 新建 Prompt（浏览器可能占用，按钮始终可用）。只在应用有焦点、正确作用域、非 IME composition 时触发；Enter、Ctrl/Cmd+Enter 都不提交，不拦截中文输入确认键。

字数按 Unicode code point 数量（含空白）显示；粗估 Token=`ceil(中日韩字符数 + 其余字符数/4)`，空内容为 0，明确“粗略估算”，不作为计费/上下文限制判断。

## 11. 依赖及 package.json 建议

首次搭建使用 Vite react-ts 模板，将生成文件与现有五份文档合并，不能清空仓库重建。建议 Node 22.x >=22.12；设置 `.nvmrc` 为 `22`，package engines 为 `>=22.12.0 <23`。精确依赖版本由初始化当日兼容验证后固定到 lockfile，不在文档写未经验证的版本号，不长期保留 latest/*。不安装任何服务端运行时依赖。

```bash
npm install react react-dom react-router-dom zustand dexie zod
npm install @codemirror/state @codemirror/view @codemirror/commands @codemirror/lang-markdown
npm install react-markdown lucide-react
npm install -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/node
npm install -D @types/wicg-file-system-access eslint @eslint/js typescript-eslint
npm install -D eslint-plugin-react-hooks eslint-plugin-react-refresh prettier
npm install -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
npm install -D fake-indexeddb @playwright/test
```

CSS 默认使用 CSS Modules + CSS variables，避免为主题增加复杂依赖。Tailwind 是 PRD 的建议选项，不是硬约束；如选用必须记录版本及插件配置，不混合多个样式体系。V0.1 不需要 diff、拖拽框架、PWA、完整 tokenizer 或全文检索服务；排序使用原生拖拽并保留键盘替代操作。

package.json 初始核心字段（依赖部分通过上面的安装命令写入）：

```json
{
  "name": "promptdesk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.12.0 <23" },
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "build": "npm run typecheck && vite build",
    "preview": "vite preview"
  }
}
```

## 12. Pages 配置与工作流

vite.config.ts 中使用 `loadEnv(mode, process.cwd(), '')` 读取 `VITE_BASE_PATH`，默认为 `/`；验证为 `/` 或 `/仓库名/`，传给 base。客户端用 import.meta.env.BASE_URL 引用资源，不能拼接 `/assets/...`。不要把 VITE_ 变量当秘密；不需要任何 API key。

```ts
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE_PATH || '/';
  if (!/^\/(?:[A-Za-z0-9._-]+\/)?$/.test(base)) throw new Error('Invalid base path');
  return { plugins: [react()], base };
});
```

项目站点 URL 为 `https://<user>.github.io/<repo>/#/project/<projectId>`。Hash 内的 id 用 encodeURIComponent，并在路由入口校验；URL 不携带正文和本地路径。GitHub Pages 的配置流程依据 [官方自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

以下为 deploy.yml 起点；Actions 主版本参考 2026-09-26 的 [Vite 部署示例](https://vite.dev/guide/static-deploy)，实施时确认后可固定完整 commit SHA。main 是约定默认分支，若仓库不同应同时修改触发条件和发布规则。

```yaml
name: Deploy PromptDesk
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test
      - run: npm run build
        env:
          VITE_BASE_PATH: /promptdesk/ # 修改为仓库名；根域名部署用 /
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist
  deploy:
    if: github.ref == 'refs/heads/main'
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v5
        id: deployment
```

另建 ci.yml 在 pull_request 与 main push 上运行相同质量检查，可加格式检查及 Playwright 合成流程，权限仅 contents:read。不得对不可信 PR 使用 pull_request_target 执行其代码。真实目录授权必须通过桌面浏览器手测，fake 适配器测试不能替代。

建议 `.gitignore` 至少包含 node_modules/、dist/、coverage/、playwright-report/、test-results/、.env.local、.env.*.local、workspaces/、.promptdesk/。不要全局忽略 _.md/_.json 或所有 projects/，以免吞掉源码和文档。构建前检查 tracked 文件以及 dist，真实 Workspace 必须在仓库外；ignore 只是辅助，不是完整隐私保证。

## 13. 验证策略

- 单元：schema、状态副作用、版本去重/恢复编号、路径段校验、筛选解析和排序。
- 集成：内存 FileSystemPort + fake-indexeddb；对 prepare、正文、版本、meta、commit、清理各阶段注入失败；验证重开和重复恢复。
- UI：编辑防抖竞态、IME、复制不改状态、保存失败提示、Workspace 切换隔离。
- 真机：Chrome/Edge 原生选目录、句柄恢复、授权拒绝/撤销、清空缓存、外部编辑、刷新、关闭重开。
- 发布：本地子路径构建预览 + 真实 Pages 测试；Network 验证无业务上传和远程图片请求；只发布应用构建资源。

验收规模使用合成数据：10 个 Project × 100 个 Prompt × 每个正文约 10KB；导航阶段不读全部正文，界面可响应，全文索引有进度与取消。记录测试电脑/浏览器和观察结果，不把未经测量的毫秒指标写为既成事实。
