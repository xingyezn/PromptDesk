# V0.2-02 手机速记与 PWA 自动化验证

日期：2026-09-27  
测试数据：Playwright 合成记录；没有打开真实 Workspace 或使用真实正文。  
范围：本机速记、独立 IndexedDB 数据库、导出/删除、GitHub Pages 子路径 manifest、版本化静态缓存、离线应用 shell 与速记恢复。

## 验证结果

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run test`：8 个测试文件、69 项通过。包含速记 DB 独立于 Workspace 缓存清理的单测。
- `npm run test:e2e -- --workers=1`：10 项通过、1 项生产专用测试按预期跳过。速记流程覆盖 390×844 视口下本机保存、重新加载、导出 JSON、删除确认，以及未保存修改的离开确认。
- `npm run test:e2e:production`：构建 `/PromptDesk/` 子路径产物并运行 10 项 E2E，全部通过；包括 manifest/SW 路径校验、离线重载 shell 和重新读取本机速记。
- service worker 清单按构建产物文件名和 public manifest/icon 内容生成版本号。仅拦截其构建清单里的同源静态文件和应用导航；`/api` 路径、查询参数和非清单资源不缓存。
- `npm run build`：typecheck/build 通过；独立生产 E2E 也以 `/PromptDesk/` 子路径重新构建并通过。

## 未验证

- 未使用实体 iPhone/iPad、Android 手机或桌面 Chrome/Edge 手工验收安装提示、主屏启动、键盘、安全区和真实离线行为。生产浏览器自动化不替代这些设备测试。
- 浏览器站点数据清理可能删除 `promptdesk-mobile-notes`；应用只能提供导出，不承诺浏览器替用户保留或跨设备同步。
- PWA 更新提示/激活流程有实现，自动化未模拟真实第二版 SW 更新周期。
- 构建仍提示主应用与 Markdown 编辑器 JS chunk 超过 500 kB；构建通过，后续可独立优化。
