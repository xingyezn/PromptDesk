# GitHub Pages dev.5 部署验证

日期：2026-09-27  
仓库：[xingyezn/PromptDesk](https://github.com/xingyezn/PromptDesk)（公开）  
发布提交：`be969d34b69ea13ec41f8e99f9dd68cf61753744`  
在线地址：[https://xingyezn.github.io/PromptDesk/](https://xingyezn.github.io/PromptDesk/)

## 部署结果

- Pages 发布源配置为 GitHub Actions，HTTPS 强制开启。
- [CI workflow run](https://github.com/xingyezn/PromptDesk/actions/runs/36260519381) 成功。
- [Deploy workflow run](https://github.com/xingyezn/PromptDesk/actions/runs/36260519373) 第二次尝试成功；首次因新仓库尚未启用 Pages 发布源而在 `configure-pages` 失败，随后启用 `workflow` 发布源并重跑。
- workflow 构建仓库子路径 `/PromptDesk/`，上传并部署 `dist/`；生产预览 E2E 8 项通过，CI E2E 9 项通过。

## 线上检查

| 检查                                               | 结果                                               |
| -------------------------------------------------- | -------------------------------------------------- |
| `https://xingyezn.github.io/PromptDesk/`           | HTTP 200；页面标题为 PromptDesk · 本地提示词工作台 |
| `https://xingyezn.github.io/PromptDesk/#/settings` | HTTP 200，HashRouter 静态入口正常返回              |
| 发布的 JS 与 CSS 资源                              | 均 HTTP 200，路径包含 `/PromptDesk/assets/`        |
| GitHub 仓库可见性                                  | Public                                             |

仓库仅推送应用源码、开发文档及标注为合成数据的测试 fixtures；没有把用户 Workspace 或 `dist/` 加入仓库。GitHub Pages artifact 只从工作流构建产物 `dist/` 上传。

## 尚未验证

- 真实桌面 Chrome/Edge 原生目录 picker、授权/撤权、磁盘读写、句柄重用和多窗口流程。
- 在线页面对真实本地 Workspace 的创建、打开、编辑保存、重新打开、ZIP 与目录迁移往返。
- 公开站点可访问和静态资源加载已验证；这不等于 V0.1 原生权限和数据可靠性发布验收完成。

本次 Pages 发布用于当前 dev.5 开发预览。另有已知构建提示：编辑器 chunk 约 510 kB、主 chunk 约 566 kB（gzip 分别约 178/175 kB）。
