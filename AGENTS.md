# Codex 开发约定：PromptDesk

本文件应放在 PromptDesk 应用仓库根目录，对该仓库开发生效。目标是实现 README、TECH_SPEC、DATA_SCHEMA 和 V0.1_TASKS 定义的 V0.1，不自行加入云端或模型执行能力。

## 1. 开工与范围

1. 先阅读 README.md、TECH_SPEC.md、DATA_SCHEMA.md、V0.1_TASKS.md，再检查现有代码、Git 状态及工作流。
2. 保留已有文档、未提交修改和用户文件；空仓库按 TASK-01 搭建，有代码时增量实现，不清空重建。
3. 按任务依赖完成最小纵向链路：授权 → 项目 → Prompt → 落盘 → 重开 → 版本/状态。不能先堆 UI 再绕开存储边界。
4. 每次完成任务在 V0.1_TASKS 更新复选框和验证证据，未实际验证不得标记完成。
5. 不创建或操作真实用户 Workspace 来做测试。使用仓库外临时目录和合成 fixtures；演示数据必须可识别为合成。
6. 本地运行、修复、构建、合成测试属于开发范围；是否创建 PR、发布或推送由当前用户授权决定，不从本文件推断额外授权。

数据定义以 DATA_SCHEMA 为准；接口与层次以 TECH_SPEC 为准。发现矛盾先同步修改文档和相关调用者，记录理由；不能悄悄换字段、状态名或持久化方案。

## 2. 架构硬边界

- 必须纯前端 React + TypeScript + Vite，GitHub Pages 能独立运行；不要求用户启动本地服务。
- filesystem 层独占 File System Access API；cache 层独占 Dexie；clipboard service 独占剪贴板访问。UI 通过 service/use case 调用，不能散落访问浏览器存储或文件 API。
- domain 只依赖纯 TypeScript；services 不导入 stores/components；Zustand 不作为磁盘数据权威来源。
- 所有业务写入走同一 Workspace 队列与可恢复事务；禁止另写“快速保存”路径。
- 本地文件是权威来源，IndexedDB 可清空重建。不得从缓存恢复后无检查覆盖磁盘。
- 目录句柄不进 URL、业务 JSON、日志或全局持久化 store；无法获得的本地完整路径不要伪造。
- Workspace/Persistent schema 与 DB cache schema 分开版本化；当前不做自动迁移、降级。

## 3. 文件与隐私规则

- 只操作用户明确选择的 Workspace，且只写 DATA_SCHEMA 定义的应用文件。根目录其他资料保持原样。
- 创建 Workspace 必须预检并展示拟新增目录；非空初始化要应用内确认；存在应用路径冲突则拒绝，不“接管”已有目录。
- 所有路径按段白名单校验，拒绝绝对路径、`..`、分隔符和非法设备名。ID/slug 从磁盘校验后才可用来构造路径。
- 版本不可变；禁止覆盖已有 vNNN.md、复用已删除 Prompt ID、通过列表长度计算版本号。
- 删除采用 deletedAt 逻辑删除，须应用内确认。V0.1 不实现永久删除 Project/Prompt/Version；pending 清理只处理验证过的应用临时副本。
- 不假定目录 move/rename 或多文件原子提交存在。不得用内存回滚冒充磁盘回滚，不得失败后丢弃恢复记录。
- 任何写入只有 close 和提交校验成功后显示“已保存到工作空间”。缓存成功不等于文件成功。
- 权限拒绝、外部修改、磁盘异常时保留未保存草稿；禁止静默重试覆盖和自动弹授权循环。
- 日志和测试报告不得含真实正文、项目名称、标签、路径或 DirectoryHandle。

## 4. 产品行为不能改变

- Enter 只换行；Ctrl/Cmd+Enter 不提交；IME composition 的 Enter 不触发业务动作。
- 复制与提交独立；复制成功不更新状态、提交时间或版本。应用不提供“发送到模型”。
- 自动保存只保存 current.md 与相关元数据，不产生 Version。
- 手动保存版本、进入 ready、确认 submitted 按规范建立/复用检查点，先成功落盘再改状态。
- 历史恢复先保留当前草稿，再新建恢复版本，不删除后面的历史；状态不自动回退。
- 人工状态允许跳转，不能用严格线性工作流限制用户；所有副作用统一在 domain policy/service 实现。
- Prompt 编辑始终提供未保存/保存中/已保存/失败/冲突反馈，不能只弹一闪而过的 toast。
- 已归档 Project/Prompt 只读，取消归档后编辑；已删除条目可恢复，归档不等于删除。

## 5. TypeScript 与代码规范

- strict=true；启用 noUncheckedIndexedAccess 和 exactOptionalPropertyTypes。对浏览器 API 缺失使用能力检测和窄化，不使用大范围 any、ts-ignore 或断言遮蔽错误。
- 输入 JSON 类型为 unknown，使用 Zod 校验；schema 推导 domain 类型。patch 明确列允许字段，不把 Partial<完整对象> 当写入接口。
- 函数/变量 camelCase；React 组件与类型 PascalCase；状态值沿用规范小写枚举。文件按所在模块统一命名，不重复建立多个 utils/storage。
- 纯函数表达状态副作用、排序和版本策略；IO 使用 Result<T>/统一 AppError，所有 Promise 必须处理异常。
- 依赖可通过端口注入，测试不 mock 整个业务 service 掩盖真实规则。避免组件承担多文件事务。
- React hooks 清理 timers、订阅与加载任务，处理 StrictMode 重复 effect；id 创建、写盘不能放在可重复执行的 render/effect 中。
- 每个异步回调带 sessionId/entityKey，防止关闭后写入旧会话或把旧保存结果标到新 Prompt。
- 使用 Prettier、ESLint；注释说明原因、并发限制或恢复边界，不重复代码字面意思。
- UI 默认中文，与既定状态文案一致；界面不暴露原始堆栈或术语型错误，诊断可提供相对文件名。
- 按钮、输入框有可访问名称；弹窗管理焦点和 Esc；保存状态可被辅助技术感知；快捷键不能代替按钮。

## 6. 禁止事项

不得加入：后端、云数据库、登录/OAuth、GitHub 数据存储、云同步、LLM API/SDK、第三方 analytics/远程错误监控、自动读取/发送模型对话、Git 自动提交 Workspace。

不得通过 fetch/XHR/WebSocket/sendBeacon 发出业务内容；不得在 URL、查询参数、fragment 中放正文/本地路径；不得为 Markdown 预览加载远程图片/字体或执行 raw HTML。链接必须经安全协议过滤并由用户点击，不能后台预抓取。

不得将真实 Workspace 放进仓库、public、src、fixtures、CI artifact 或 Pages dist；不得用 VITE_ 保存秘密，不假定 GitHub Pages 提供服务端密钥隔离。不得为了“不支持的浏览器”偷偷改用 IndexedDB 作为唯一业务库。

不得宣称完整离线启动、操作系统级锁、多浏览器/多电脑同步、无损瞬间关闭、完全原子多文件写入或原生权限已经被 mock 测试覆盖。PRD 非目标不得通过依赖“顺便加入”。

## 7. 验证要求

每个任务执行与修改相关的检查。格式和构建基础检查在脚本可用后执行：

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

影响 UI 的改动运行相应 Playwright/组件流程；影响文件/版本/状态的改动必须覆盖失败与恢复，不仅测正常路径。关键测试包括：延迟保存乱序、新输入期间旧保存完成、版本落盘但 meta 失败、授权撤销、恢复重试不重复编号、外部文件 hash 改变、缓存清空、Workspace 切换、删除/恢复关系。

原生目录 picker、授权、句柄重用、设备读写必须在桌面 Chrome/Edge 手测并记录浏览器版本。无法完成真机检查时明确列为未验证，不以自动化替代。发布用子路径构建并刷新 hash 路由；检查 Network 与构建产物没有业务内容。

## 8. 提交与交付

一次变更围绕一个完整任务或可独立验证的纵向功能，避免仅改 UI 而 service 未实现的“完成”。先完成检查再更新任务状态。交付说明写清：实现了什么、如何验证、仍未验证什么和相关文档更新；不能写“全部通过”却漏掉原生权限验收。

安全关键规则（schema、自动保存、版本、事务、权限）改变时必须同步 TECH_SPEC/DATA_SCHEMA 和任务验收。依赖升级固定 lockfile，记录 Node 兼容性，不在提交中遗留 latest 或安装失败结果。所有测试 fixtures 和截图仅用合成内容。
