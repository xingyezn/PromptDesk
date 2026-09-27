> **V0.3 当前产品约束（2026-09-27）**：用户明确要求关闭 GitHub Pages，取消本地工作空间。Cloudflare Workers 同源托管 React 前端/API，D1 是所有账户项目、提示词、历史版本的权威来源。登录后进入个人空间，API 根据会话 userId 隔离；管理员仅管理账户，不默认读取其他人的正文。旧章节仅是 V0.1/V0.2 历史规格，不再限制当前云端实现。既有本地文件保持原样，不自动导入。任务见 V0.3_TASKS.md。

## V0.3 云端数据库（当前 schema=3）

- `user_access(userId PK/FK user, role user|admin, disabled 0|1, mustChangePassword 0|1)`；新用户 trigger 默认 user，客户端不可写角色。
- `cloud_project(id UUID PK, ownerId FK user, name, description, revision≥1, operation, archived 0|1, deletedAt, createdAt, updatedAt)`，UNIQUE(id,ownerId)，owner 索引。
- `cloud_prompt(id UUID PK, projectId, ownerId, title, body, status draft|ready|completed, priority low|normal|high, sortOrder, revision≥1, nextVersion≥1, operation, deletedAt, createdAt, updatedAt)`；复合 FK(projectId,ownerId) 防止错误归属，owner/project/order 索引。默认未命名提示词，无创建标题表单。
- `cloud_version(id UUID PK, promptId, ownerId, number, body, createdAt)`，UNIQUE(promptId,number)，复合 FK(promptId,ownerId)，UPDATE trigger 拒绝变更；仅账户永久删除会级联清理版本。
- `cloud_usage(userId FK, bytes)`，CHECK 0≤bytes≤10MiB，正文/版本增删改 trigger 更新真实 UTF-8 字节数；软删除不释放额度。
- DB 日期字段 cloud 表用 UTC ISO 字符串，BetterAuth auth 表接受适配器写入的 ISO 日期文本及历史毫秒整数；role/布尔字段整数，API 不泄漏 ownerId/operation/hash/password。DAO 返回数据以 src/domain/cloud.ts 校验。
- Prompt 逻辑删除可恢复；完成与删除独立。已完成自动进入已完成分组，但不自动设 archived/禁止修改；项目归档只读，取消归档后编辑。排序和优先级独立，手动拖拽调整 sortOrder。
- 本地 Workspace schema=2 不再是当前数据源；与 D1 schema=3 无自动映射。用户磁盘/旧缓存不读取不上传；旧账户迁移仅新增默认权限与空个人空间，不改密码、不改邮箱状态。

# PromptDesk V0.1 数据规范

## 追加约定：备份、迁移及快速新建（2026-09-26）

本节以下“schema v2”补充现行磁盘格式。新 Prompt 默认 title 为“未命名提示词”；Prompt 状态改为 `draft | ready | completed`，并增加 `priority: low | normal | high`。schema v1 不会静默打开或改写；应用先展示状态映射预览，用户确认后以可恢复事务迁移。旧 archived Prompt 逐条选择新状态。完整映射见“schema v1 到 v2 的确认迁移”。

本地 ZIP 与复制迁移只包含本规范定义的 `.promptdesk/workspace.json`、`settings.json`、`projects/<slug>/project.json`、可选 `README.md`、Prompt `meta.json/current.md/versions/vNNN.md`、可选 `result.md`、Scratchpad `meta.json/current.md`。包括已归档/逻辑删除项；保留 JSON 未知字段和所有历史版本的原文本。不会添加额外 schema、不会修改复制文件的 revision/时间/ID。

缓存与 pending 不复制；源 pending 非空先恢复；根目录其他文件由用户自行管理。应用目录内出现未知文件、坏 schema、缺关联文件或版本 hash 不一致则阻止打包迁移，不静默遗漏。根外路径和不合法段禁止操作。转移限制最多 5000 文件、总 32 MiB、单文件 5 MiB；这是当前实现容量，不等同于所有 Workspace 的上限。

迁移要求用户选择空目标并确认，目标使用 initialize pending（before 全空，after 全量），根标识最后写；可以复用现有初始化恢复流程，准备阶段不完整则保留副本做诊断。原目录保留不删除；新目录保持 workspaceId，缓存目录身份必须重新计算 recentKey，不串恢复草稿。ZIP 解压后按已有 Workspace 打开；不自动迁移 schema，不实现压缩包直接导入。

工作流补充：Scratchpad 转入将源 current.md 的不变内容也作为事务前置/核对目标，防止复制时接受过期正文。源 meta.transferredTo 是重复操作的唯一目标依据；转入与排序使用现行 schema v2 字段和 ID/order 规则，不增加迁移标记。归档 Project 的内容/资料只读；相关项目结构操作维持 order 连续，不改变归档状态和历史。

搜索 cache schema 仍为 DB v1，searchIndex 记录增加 recentKey（非句柄）、contentHash、revision，磁盘重读后写缓存；当前只用内存索引展示，不将未经磁盘核对的缓存当作正文来源。清空缓存不改磁盘；Scratchpad 恢复副本 entityKey 为 scratch:<id>，目前保存未落盘正文，不包含未保存标题。Settings 文件缺失或损坏时保持只读，不猜测可写默认配置。

日期：2026-09-26。当前磁盘 schemaVersion=2；IndexedDB dbVersion 独立维护。schema v1 为受支持的迁移输入格式，未确认前只读预览；不支持的未来版本拒绝写入。本文将 PRD 示例字段细化为正式开发契约，补充 revision、版本元数据、状态历史、优先级、逻辑删除和恢复记录。PRD 中的简略 JSON 是产品示意，不是已发布格式；缺字段的真实目录不得默默补齐后覆盖。

## 1. 权威来源与目录结构

```text
<用户选择的 Workspace>/
  .promptdesk/
    workspace.json                   # 根标识，创建时最后落盘
    settings.json                    # Workspace 偏好，缺失可用默认值
    pending/
      <operationId>/
        manifest.json                # 多文件操作恢复说明
        before/0001.txt              # 原始 UTF-8 内容副本（按需）
        after/0001.txt               # 拟写入的 UTF-8 内容副本
  projects/
    wetalk-analysis/                 # immutable slug，不随显示名改动
      project.json
      README.md                      # 可选用户资料，V0.1 不自动修改
      prompts/
        P001/
          meta.json
          current.md                 # 当前可编辑草稿
          versions/
            v001.md                  # 不可变快照
            v002.md
          result.md                  # 可选，V0.1 原样保留，不提供结果编辑 UI
        P002/...
  scratchpad/
    <scratchpadId>/
      meta.json
      current.md
```

根目录其他用户资料不扫描、不上传、不重命名。所有读写路径由已校验的 ID/slug 构造，不能将标题、标签、URL 或手工输入路径直接用于文件操作。使用 segments 数组并从根句柄逐级解析，禁止绝对路径、空段、`.`、`..`、斜杠、反斜杠、控制字符、Windows 保留设备名和尾部点/空格。没有全盘搜索或绝对路径访问接口。

Project 目录名=slug；slug `[a-z0-9]+(?:-[a-z0-9]+)*`，最长 64 字符且不能为保留设备名。中文显示名可用 `project-<随机短后缀>` 生成 slug，同名冲突追加后缀。创建后 slug 不变，项目重命名只改 name。Project.id 为 `project_<UUID>`，Workspace.id 为 `workspace_<UUID>`，Scratchpad.id 为 `scratch_<UUID>`，operationId 为 `op_<UUID>`，UUID 用 crypto.randomUUID()。

Prompt.id 为项目内 `P001`、`P002`…（至少三位，允许 P1000）；业务引用必须同时带 projectId。分配 max(当前磁盘中合法 P 编号，包含已删除项)+1；损坏但具有合法编号的目录也占号，避免覆盖。不能通过列表长度或 IndexedDB 分配 ID。Version number 正整数，文件名 `v${String(number).padStart(3,'0')}.md`，v1000 合法，不截断，不复用已存在编号。

## 2. 通用约定与校验

JSON UTF-8，2 空格缩进，末尾换行。时间为 UTC ISO 8601，例如 `2026-09-26T10:00:00.000Z`；UI 转本地时区。文本正文保持用户输入，不 trim 后写入；仅用 trim 判断能否提交。SHA-256 为实际 UTF-8 字节的 64 位小写十六进制摘要，不进行隐含换行转换。时间不用于判断写入先后，版本号和 revision 才用于顺序。

每个当前 JSON 文档有 schemaVersion=2。schema v1 的原始字段在迁移预览期间按 v1 schema 单独校验。revision 为非负整数，创建为 0，每次该文件业务内容提交加 1；不因读取/缓存增加。lastOperationId 为最近成功事务 ID，创建后非空。createdAt 创建后不变，updatedAt 业务写入时更新。不得由 UI 随意传入这些字段。

字段除明确为 optional 的兼容项外均必需；nullable 使用 null，不混用空字符串。字符串以实际 Unicode 文本存储，不限制用户正文语言。默认空 tags、notes、description 等必须写入，不依赖消费者猜测。

Zod schema 是代码内唯一校验实现，由其推导类型。读取 JSON 使用 unknown → parse → Zod；不能用 `as PromptMeta` 绕过校验。未知顶层字段保留但不展示/执行，不允许应用 patch 修改未知字段；写回时保留未知字段，不能用默认 strip 丢数据。未知枚举、非法关系、缺必需字段属于 INVALID_SCHEMA。正式升级改变语义必须增加 schemaVersion，不能依靠未知字段偷偷切换格式。

| 字段类别                                       | 校验                                                          |
| ---------------------------------------------- | ------------------------------------------------------------- |
| Workspace/Project/Prompt/Scratchpad name/title | 去首尾空白后 1–200 字符；显示标题与正文不同                   |
| description/notes/version note                 | 最多 10,000 字符；可为空                                      |
| tags                                           | 最多 50 项，每项去首尾空白后 1–64 字符，区分大小写去重        |
| target/defaultTarget                           | 1–100 字符，自由文本；预设 Codex/ChatGPT/Claude/DeepSeek/其他 |
| revision/currentVersion/order                  | 整数；revision/currentVersion>=0，order>=1                    |
| Markdown 文件                                  | 可为空；V0.1 支持上限单文件 5MiB，超限只读提示，不截断        |
| JSON 文件                                      | 最大 5MiB，超限只读提示；历史较大时不自动压缩/删除            |
| references/hash/date                           | 格式校验及业务关系校验，不用字符串 truthy 判断                |

文件大小上限是 V0.1 的工程保护，不是磁盘格式上限；不能通过超限处理破坏可移植文件。

## 3. TypeScript 逻辑模型

以下定义用于说明完整字段。实现时应先写等价 Zod，再用 z.infer 导出类型；不要并行维护两套不一致的字段定义。

```ts
type ISODate = string;
type UUIDId = string;
type PromptStatus = 'draft' | 'ready' | 'completed';
type PromptPriority = 'low' | 'normal' | 'high';
type VersionReason = 'manual' | 'ready' | 'submitted' | 'before_restore' | 'restore';
interface BaseDocument {
  schemaVersion: 2;
  revision: number;
  lastOperationId: UUIDId;
  createdAt: ISODate;
  updatedAt: ISODate;
}
interface Workspace extends BaseDocument {
  id: UUIDId;
  name: string;
  description: string;
}
interface WorkspaceSettings extends BaseDocument {
  workspaceId: UUIDId;
  defaultTarget: string;
  autosaveEnabled: boolean;
  autosaveDelayMs: number;
}
interface Project extends BaseDocument {
  id: UUIDId;
  name: string;
  slug: string;
  description: string;
  status: 'active' | 'archived';
  tags: string[];
  deletedAt: ISODate | null;
}
interface PromptRef {
  projectId: UUIDId;
  promptId: string;
}
interface VersionMeta {
  number: number;
  fileName: string;
  createdAt: ISODate;
  reason: VersionReason;
  note: string;
  contentHash: string;
  restoredFrom: number | null;
  operationId: UUIDId;
}
interface StatusEvent {
  id: UUIDId;
  operationId: UUIDId;
  from: PromptStatus | null;
  to: PromptStatus;
  at: ISODate;
  versionNumber: number | null;
  kind: 'created' | 'transition';
}
interface PromptMeta extends BaseDocument {
  id: string;
  projectId: UUIDId;
  title: string;
  status: PromptStatus;
  priority: PromptPriority;
  target: string;
  order: number;
  parentPromptId: string | null;
  tags: string[];
  notes: string;
  submittedAt: ISODate | null;
  completedAt: ISODate | null;
  submittedVersion: number | null;
  currentVersion: number;
  versions: VersionMeta[];
  statusHistory: StatusEvent[];
  deletedAt: ISODate | null;
}
interface PromptDocument {
  meta: PromptMeta;
  body: string;
}
interface ScratchpadMeta extends BaseDocument {
  id: UUIDId;
  title: string;
  deletedAt: ISODate | null;
  transferredTo: PromptRef | null;
  transferredAt: ISODate | null;
}
interface ScratchpadDocument {
  meta: ScratchpadMeta;
  body: string;
}
```

workspace.json 不保存 projectIds 索引、计数和修改每条 Prompt 的时间；项目由扫描目录发现，避免全局清单成为易坏的依赖。Project.updatedAt 仅表示 Project 元数据修改，不因子 Prompt 自动保存而增加；最近活动可由子对象最大 updatedAt 推导，不重复写文件。

WorkspaceSettings 默认 defaultTarget=`Codex`、autosaveEnabled=true、autosaveDelayMs=800；设置修改落盘。settings.json 缺失时使用默认值并提示可保存，损坏时不自动覆盖。主题、折叠栏、最近选择、Flow/List 视图是浏览器 UI 偏好，只存 IndexedDB，不影响核心数据可移植性。

## 4. 示例数据

以下示例是合成数据，UUID 仅用于演示；实际创建使用随机 UUID。这个 Prompt 已保存一个 ready 检查点，尚未提交。

workspace.json：

```json
{
  "schemaVersion": 2,
  "revision": 0,
  "lastOperationId": "op_11111111-1111-4111-8111-111111111111",
  "id": "workspace_22222222-2222-4222-8222-222222222222",
  "name": "Research Workspace",
  "description": "本地研究提示词",
  "createdAt": "2026-09-26T10:00:00.000Z",
  "updatedAt": "2026-09-26T10:00:00.000Z"
}
```

project.json：

```json
{
  "schemaVersion": 2,
  "revision": 0,
  "lastOperationId": "op_33333333-3333-4333-8333-333333333333",
  "id": "project_44444444-4444-4444-8444-444444444444",
  "name": "WeTalk 数据分析",
  "slug": "wetalk-analysis",
  "description": "数据清洗与研究分析",
  "status": "active",
  "tags": ["Research", "WeTalk"],
  "deletedAt": null,
  "createdAt": "2026-09-26T10:05:00.000Z",
  "updatedAt": "2026-09-26T10:05:00.000Z"
}
```

Prompt meta.json：

```json
{
  "schemaVersion": 2,
  "revision": 1,
  "lastOperationId": "op_55555555-5555-4555-8555-555555555555",
  "id": "P001",
  "projectId": "project_44444444-4444-4444-8444-444444444444",
  "title": "制定数据检查方案",
  "status": "ready",
  "priority": "normal",
  "target": "Codex",
  "order": 1,
  "parentPromptId": null,
  "tags": ["analysis"],
  "notes": "只分析，不修改文件",
  "submittedAt": null,
  "completedAt": null,
  "submittedVersion": null,
  "currentVersion": 1,
  "versions": [
    {
      "number": 1,
      "fileName": "v001.md",
      "createdAt": "2026-09-26T10:10:00.000Z",
      "reason": "ready",
      "note": "初始检查方案",
      "contentHash": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      "restoredFrom": null,
      "operationId": "op_55555555-5555-4555-8555-555555555555"
    }
  ],
  "statusHistory": [
    {
      "id": "event_66666666-6666-4666-8666-666666666666",
      "operationId": "op_77777777-7777-4777-8777-777777777777",
      "from": null,
      "to": "draft",
      "at": "2026-09-26T10:06:00.000Z",
      "versionNumber": null,
      "kind": "created"
    },
    {
      "id": "event_88888888-8888-4888-8888-888888888888",
      "operationId": "op_55555555-5555-4555-8555-555555555555",
      "from": "draft",
      "to": "ready",
      "at": "2026-09-26T10:10:00.000Z",
      "versionNumber": 1,
      "kind": "transition"
    }
  ],
  "deletedAt": null,
  "createdAt": "2026-09-26T10:06:00.000Z",
  "updatedAt": "2026-09-26T10:10:00.000Z"
}
```

为了给出可核对的真实 hash，示例 current.md 与 versions/v001.md 的精确 UTF-8 内容均为 `abc`，没有结尾换行。实际正文通常为多行 Markdown，hash 必须从实际内容计算，不能复制示例摘要。

## 5. 关系、排序与完整性规则

- Workspace 可有多个 Project；同一运行会话只打开一个 Workspace。
- 同 Workspace 的 Project.id、slug 各自唯一；meta.projectId 必须等于所在 project.json.id；meta.id 必须等于 Prompt 目录名。
- parentPromptId 仅指同项目中的 Prompt，不允许自己或祖先形成循环；它是规划关联，不强制父任务完成才能编辑或提交。
- 父 Prompt 被删除时引用保留，显示“前置 Prompt 已删除”；恢复父 Prompt 后重新可见。不级联删除后续 Prompt。缺失父引用显示诊断，不自动改写。
- order 为项目内非删除 Prompt 的显示顺序；正常提交后为 1..N 连续整数（包含归档 Prompt）。重排输入必须恰好包含全部非删除 ID，事务内统一写 meta；损坏条目先修复或只读，不能漏过后强行重排。
- createNext 设置 parentPromptId=当前 ID，插入其后，后续 order 顺移。普通创建放末尾。删除后事务压缩剩余 order；恢复 Prompt 插到末尾，不复用旧排序；已删除对象原 order 留作历史。
- 拆分选区时选中文字逐字成为新 Prompt 正文，未选中文字拼接后留在原正文；两段都必须非空。新 Prompt 由磁盘最大 ID 分配，parentPromptId 指向原条目，紧随原条目插入并顺移后续 order；原状态和版本历史不回退，拆分写入不生成 Version。原正文、新正文、两份 meta 和排序关系通过同一 Journal 提交，取消对磁盘无影响。
- 新 Prompt 初始 draft、currentVersion=0、versions=[]、submittedVersion=null、时间字段 null；创建一条 created 事件。可编辑 current.md 并不等于已保存 Version。
- Prompt.currentVersion 是已提交到 meta 的最大版本号，不表示 current.md 与该版本相同。UI 如不同显示“当前草稿有改动”。
- versions.number 唯一且递增，fileName 必须与 number 相符；submittedVersion、StatusEvent.versionNumber 必须指向已有版本。
- 每次加载导航只验证 meta 内部关系，打开历史时验证版本文件与 contentHash。版本缺失/损坏不阻止 current.md 只读查看，但禁止基于损坏历史继续版本写入。
- 发现 versions 下未被 meta 引用的文件：可能为中断写入，先检查 pending。不能无条件纳入历史或覆盖；无可验证的恢复证据时提示孤立版本并只读诊断。
- ID 分配和版本编号要扫描磁盘已有文件，任何已存在目标都不能覆写；索引和缓存不是完整性证据。

## 6. Prompt 状态与优先级

当前 schema v2 只允许 `draft | ready | completed`。界面分别显示“草稿”“待提交”“已完成”。项目 Prompt 列表以 checkbox 表示完成操作，点击后进入项目内“已完成”分组；未完成项始终在待办分组。取消勾选恢复最后一次有效的非 completed 状态，缺少该历史时恢复 draft。completed 条目只读，取消勾选后恢复编辑。

用户可以从编辑页或跨项目队列手动切换任意状态，不强制线性顺序。进入 ready 或 completed 前正文 trim 后非空，并先保存/复用对应检查点，再写状态。切换失败状态不变。same-status 操作若正文不同，创建新的正文检查点但不增加重复状态事件；内容与最新版本相同则复用版本。草稿自动保存只写 current.md 与元数据，不增加 Version。复制成功不改变状态、时间或版本；应用不发送 Prompt。

每条 Prompt 另有 `priority: low | normal | high`，默认 `normal`。priority 与 `order` 独立；priority 不会覆盖用户拖拽的顺序，order 是项目内明确顺序。完成分组单独显示，切换组不改变磁盘状态或顺序。

`completedAt` 记录最近一次进入 completed 的时间；撤销完成不清空历史时间。`submittedAt` 与 `submittedVersion` 是 schema v1 留存的外部提交历史字段，在 v2 不再由应用写入或作为当前状态依据。StatusEvent 的首项 created 必须 from=null，其余 from 必须与上一项 to 相符；事件 kind 仅为 created/transition。Version 保存和恢复本身不改变状态，也不追加状态事件。Project 的 `archived` 状态仍独立存在，归档项目只读。

逻辑删除只写 deletedAt，不改变 status；默认列表、统计和搜索排除。状态历史不因删除而清除。

## 7. 版本策略

### 7.1 创建与去重

自动保存从不创建版本。显式“保存版本”、进入 ready 或 completed 创建检查点。普通 checkpoint 如果正文 hash 与最新版本相同，复用已有 number，不新建文件；新的 note 不改写旧 VersionMeta，界面说明内容未变化。若与较早版本相同但与最新不同，创建新版本，因为代表新的操作时点。`submitted` 仅为旧 VersionMeta 的兼容历史 reason，新操作不生成。

新编号至少大于 meta 中最大值及磁盘中所有合法版本文件编号。存在孤立文件先解决恢复问题，不能跳号掩盖问题。版本正文不可变，VersionMeta 提交后不可修改；V0.1 不允许删除单个版本，避免提交引用悬空。未来实现版本删除须独立设计确认和引用保全。

操作先把准确编辑正文保存 current.md，再写新版本（如果需要），最后在事务内更新 meta.versions/currentVersion。版本号只有整个事务成功才成为业务可见。checkpoint 复用时可以只更新提交状态，不重复写历史文件。

### 7.2 查看与恢复

历史查看只读，不改变当前草稿或任何 status。恢复必须显示目标版本和“当前草稿会先保留为版本”的确认，随后：

1. 从磁盘读取并校验目标 hash，flush 当前编辑正文并检查冲突。
2. 若当前草稿不同于最新检查点，创建 reason=before_restore 的保护版本。
3. 创建新的 reason=restore 版本，其正文等于所选历史，restoredFrom=目标 number。恢复是显式操作，允许与最新正文相同仍创建恢复事件版本，便于追踪。
4. current.md 写为恢复正文，currentVersion 指向新 restore 版本，原 status/submittedVersion 保持不变。
5. 全部通过同一 pending 事务完成；中断时不能报告已恢复。

示例：已有 V1、V2，当前未保存草稿不同于 V2，恢复 V1 → V3 保存当前草稿，V4 为恢复快照；V1/V2 仍不变，currentVersion=4。若草稿等于 V2，则只新建 V3 restore。重复故障恢复使用相同 operationId，不重复创建 V5/V6。

## 8. Scratchpad

Scratchpad 为 Workspace 中不属于 Project 的临时文本；V0.1 不拥有 Prompt 状态和 Version，正文自动保存、可复制。转入项目时生成新的 draft Prompt，正文原样复制，defaultTarget 取 Workspace 设置，转入时不自动创建版本。

转入使用单一事务：创建目标 current.md 与 meta.json → 更新源 Scratchpad.meta 的 transferredTo/transferredAt。源文件保留且默认隐藏，在“已转入”查看只读记录；不要用不普遍可用的文件 move API。重复操作若 transferredTo 已存在且目标校验成功，返回同一 PromptRef；目标丢失进入恢复诊断，不再随机创建第二条。源删除/恢复使用 deletedAt，与转入标记独立。

## 9. pending 事务记录

```ts
interface PendingManifest {
  schemaVersion: 1;
  operationId: UUIDId;
  workspaceId: UUIDId;
  kind:
    | 'initialize'
    | 'project'
    | 'draft'
    | 'prompt'
    | 'status'
    | 'checkpoint'
    | 'restore'
    | 'reorder'
    | 'delete'
    | 'scratchpad'
    | 'settings'
    | 'migration';
  createdAt: ISODate;
  phase: 'prepared' | 'committed';
  commitMarkerPath: string[];
  entries: {
    targetPath: string[];
    before: null | { snapshotPath: string[]; sha256: string };
    after: { snapshotPath: string[]; sha256: string };
  }[];
}
```

## 10. schema v1 到 v2 的确认迁移

打开 Workspace 时若根 `schemaVersion` 为 1，应用先读取并校验 v1 文档，展示各旧状态数量和所有旧 `archived` Prompt 的 ID/标题/新状态选择。预览和取消不写文件。映射为：`idea | draft → draft`；`ready | submitted | waiting | blocked → ready`；`completed → completed`；旧 `archived` 必须逐条由用户选 `draft | ready | completed`。历史 statusHistory 中 archived 值跟随该 Prompt 的选择；其余历史值按相同映射归并。优先级默认 `normal`。

确认后重新扫描并校验文件、Prompt/Project 关联、版本 hash 和预览期间的磁盘指纹；任何目标变化、未知文件、无效关系或授权失败都停止。只更新 workspace/settings/project/prompt/scratchpad 的 JSON 元数据：schemaVersion 改为 2、revision 加 1、更新 lastOperationId/updatedAt、Prompt 增加 priority。所有正文、VersionMeta、版本编号和版本文件逐字节保留，不生成新 Version；旧提交字段/版本 reason 作为历史 provenance 保留但不再参与当前状态行为。workspace.json 最后作为提交标记，整组变更经 pending migration 事务提交。

该流程需要已取得 Workspace 写锁。确认前取消不改源数据；提交中断保留可恢复记录，不能清除或继续普通写入。成功后只按 schema v2 打开；不支持 schema 自动降级，也不提供静默迁移。

snapshotPath 相对于该 operation 目录，只能为 before/NNNN.txt、after/NNNN.txt；targetPath 相对于 Workspace，必须落在已知业务路径，不能指向 pending 本身或任意用户资料；entries 路径唯一、包含 commitMarkerPath。snapshot 文件作为备份不做 JSON 规范化，必须保留原字节。operationId 和 workspaceId 必须与目录/当前会话一致。

manifest 及每个副本写入并校验完成前不能更改业务文件。phase=committed 只是提示，恢复仍核对全部目标 hash，不能盲信标记。pending 损坏/目标出现第三种 hash 时暂停写入，保留文件只读诊断；不自动“修复”用户内容。详细提交和恢复顺序见 TECH_SPEC 第 5 节。

## 10. IndexedDB 缓存规范

数据库名 `promptdesk-cache`，初始 dbVersion=1。浏览器按 origin 隔离，不按 URL 子路径隔离；表名和 namespace 固定为 PromptDesk 自己使用，不枚举/清理其他应用数据。原生 Handle 不进入业务 JSON。

V0.2 手机快速记录使用独立数据库 `promptdesk-mobile-notes`（dbVersion=1），与 Workspace 元数据、自动保存恢复副本和缓存清理事务隔离。Store `notes` 主键为 `id`、索引 `updatedAt`；记录字段为 `{id, body, createdAt, updatedAt}`，`body` 最多 10,000 字符。它是当前浏览器的临时本机数据，不进入 Workspace ZIP/迁移、搜索索引或账户数据；用户可显式导出 JSON。清理 Workspace 缓存不删除手机速记；浏览器清理站点数据仍可能将其删除。

| Store            | 主键                                | 内容与失效条件                                                                   |
| ---------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| recentWorkspaces | recentKey（随机 UUID）              | workspaceId/name、directoryHandle、lastOpenedAt；句柄失效可重选，不删除磁盘      |
| uiPreferences    | [workspaceId, key]                  | theme、最近 project/prompt、视图、折叠；移除 recent 时可删偏好                   |
| metadataCache    | [workspaceId, entityKey]            | 校验后的摘要、revision、指纹；重开/refresh 后与磁盘重新验证                      |
| searchIndex      | [workspaceId, projectId, promptId]  | title/body/projectName/tags/status/target、指纹；保存更新，外部修改/切换副本失效 |
| recoveryDrafts   | [workspaceId, recentKey, entityKey] | 当前尚未落盘文本与基线；仅恢复辅助，用户确认后写盘                               |

```ts
interface RecentWorkspaceRecord {
  recentKey: string;
  workspaceId: UUIDId;
  workspaceName: string;
  directoryHandle: FileSystemDirectoryHandle;
  lastOpenedAt: ISODate;
}
interface RecoveryDraft {
  workspaceId: UUIDId;
  recentKey: string;
  entityKey: string; // prompt:<projectId>:<promptId> 或 scratch:<id>
  body: string;
  editSeq: number;
  baseContentHash: string;
  updatedAt: ISODate;
}
```

恢复副本必须以目录实例核对，不能把 A 目录未保存文本套到相同 workspaceId 的 B 副本。元数据与搜索缓存不包含 directoryHandle；恢复草稿和搜索正文不得进入 URL、Console、监控、构建产物。清除缓存按钮只能操作本应用 DB，先提示尚未落盘草稿可能丢失。

## 11. 损坏、迁移与可移植验收

workspace manifest 缺失：不是有效 Workspace，返回 Launcher，可选择显式初始化。若已知 pending 目录存在合法的 initialize 记录，则先进入初始化恢复，不得当新目录覆盖；计划中的 workspaceId 从经校验的 pending 读取，恢复后仍验证根 manifest。manifest 高于 1：禁止写，提示升级。版本为 0/缺失/非法：INVALID_SCHEMA，不猜格式。schema1 但缺必需字段：只读诊断，用户保留原文件后才可另行执行修复；V0.1 不提供未经定义的迁移工具。

Project/meta 单文件损坏：隔离该条目，可读取 current.md 的只读查看入口；不能因此初始化空对象覆盖或让正常条目全部不可用。Project 缺 prompts 目录时，若没有 pending/不完整创建证据可以显示空项目，首次创建 Prompt 再建目录；Prompt 缺 current.md 不猜为空，进入损坏状态。历史 hash 错误不得更新为新 hash 来掩盖损坏。

复制整个 Workspace 到另一目录/电脑，清空浏览器缓存后打开，应恢复 Project、Prompt 当前文本、所有快照及说明、状态历史、排序、关联、删除标记、Scratchpad 和 Workspace 设置。浏览器主题及未保存恢复副本不属于此承诺。人工编辑 current.md 后重新打开必须看到真实文件；历史版本由外部编辑破坏后必须告警，不能静默接受。

## 12. Worker D1 schema（独立于 Workspace）

Worker 数据库有自己的 SQL migration 序列，与 Workspace JSON `schemaVersion`、IndexedDB Dexie `db.version()` 完全分开。V0.2 由 `worker/migrations/0001_service_meta.sql` 建立 schema 探针，再由 `0002_auth.sql` 增加 Better Auth 认证表：

| 表             | 字段                                                                                     | 约束与用途                                                    |
| -------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `service_meta` | `key TEXT PRIMARY KEY NOT NULL`                                                          | Worker schema 元数据键；当前仅 `schema_version`               |
| `service_meta` | `value TEXT NOT NULL`                                                                    | 版本文本；当前为 `'2'`                                        |
| `user`         | `id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt`                | Better Auth 用户；邮箱唯一；仅账户身份信息，不含 Workspace    |
| `session`      | `id`, `expiresAt`, `token`, `createdAt`, `updatedAt`, `ipAddress`, `userAgent`, `userId` | HttpOnly Cookie 对应的会话；`userId` 外键级联删除；token 唯一 |
| `account`      | `id`, `accountId`, `providerId`, `userId`, token 字段、`password`、时间字段              | Better Auth 邮箱密码凭据；归属 `userId`，用户删除时级联       |
| `verification` | `id`, `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt`                       | Better Auth 兼容表；当前禁用邮箱验证/重置接口，不应产生新令牌 |
| `rateLimit`    | `id`, `key`, `count`, `lastRequest`                                                      | Better Auth 数据库存储的认证接口限流状态；key 唯一            |

Worker D1 只储存账户身份、密码哈希/认证凭据、会话和限流状态；不储存 API key、Prompt、Workspace 名称/路径、速记或编辑器正文。密码只由 Better Auth 处理并以其密码哈希格式写入 `account.password`。当前没有邮件发送器：注册无需邮箱验证，验证与密码重置路由被 Worker 拒绝。账户删除通过 Better Auth 删除用户，并由外键级联删除账户凭据和会话；verification/rateLimit 不由用户外键归属，当前不创建邮箱 token，限流记录按 Better Auth 策略保留。Workspace schema 不借用 Worker 用户 ID，也不因登录建立关联。Wrangler migration 是唯一演进路径，不做在线自动迁移或降级。
