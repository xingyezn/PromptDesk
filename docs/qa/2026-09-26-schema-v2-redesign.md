# schema v2 与交互改版验证

日期：2026-09-26  
版本：`0.1.0-dev.5`  
环境：Windows；Node.js `v22.20.0`；Microsoft Edge `153.0.4234.48`

## 本次实现

- Prompt 状态采用 `draft | ready | completed`，Workspace schema 升为 v2；schema v1 打开时显示只读迁移预览，旧 archived Prompt 逐条选择。映射、取消不写盘、预览后指纹变化、迁移中断完成/回退均由合成集成测试覆盖。
- 项目列表用待办 checkbox 完成/撤销完成，完成项单独分组；工作台队列也使用 checkbox。卡片减少高度，原生拖拽手柄排序，提供 Alt+↑/↓ 键盘操作。
- 左侧导航折叠状态保存在 IndexedDB UI 偏好；项目名称可在页头重命名，复制入口位于编辑器页头。
- 增加独立优先级字段和选区拆分。拆分创建新 ID、关联父 Prompt、调整顺序，在 Journal 故障注入后可恢复且不重复创建。

## 自动化结果

| 检查                               | 结果                                                              |
| ---------------------------------- | ----------------------------------------------------------------- |
| `npm run typecheck`                | 通过                                                              |
| `npm run lint`                     | 通过                                                              |
| `npm run format:check`             | 通过                                                              |
| `npm run test`                     | 7 个测试文件、59 个测试通过                                       |
| `npm run build`                    | 通过；Vite 对 510 kB 编辑器 chunk 和 566 kB 主 chunk 发出大小提示 |
| Edge `npm run test:e2e`            | 9 个 UI 流程通过                                                  |
| Edge `npm run test:e2e:production` | 8 个子路径生产预览流程通过                                        |

E2E 使用可识别的 synthetic picker 和合成 Workspace，不操作真实用户数据。生产预览验证 hash 刷新和 GitHub Pages 子路径资源；这不是实际发布到 GitHub Pages 的验收。

## 未验证

- 尚未通过真实桌面目录选择器完成 Chrome/Edge 原生授权、撤权、读写、Recent 句柄重用、多窗口和迁移目录验收；自动化 synthetic picker 不作为原生能力证据。
- 尚未部署到真实 GitHub 仓库/Pages 地址，尚未完成 HTTPS 页面实际刷新和真实工作空间往返验收。
- 窄屏、全键盘与读屏保存状态验收仍待完成。
- schema v1 中断迁移的 service 完成/回退已合成验证；浏览器界面的恢复页和回退后重返预览已有 Edge E2E。授权拒绝、外部变化后的恢复分支仍待手测。

数据说明：测试正文、项目名称和工作空间全部为合成内容。应用业务数据未发出网络请求；隐私 E2E 检查通过。没有创建提交、PR 或部署。
