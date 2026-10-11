# 星际探索开发与交付

用户要求：每次修改 GitHub 中的游戏或网站代码后，同步到公开网站，让刷新即可调试。使用现有检出，不另建 worktree。先读取 README.md 与 docs/WEBSITE.md，保留用户已有修改。

- 正式源码在 `main`；`.github/workflows/deploy-site.yml` 在每次推送后自动构建并部署网站，不能只更新下载 ZIP 或本地服务。
- `npm run build:site` 生成 Pages 网站，项目路径为 `/space_exploration/`；首页是 `dist-site/index.html`，游戏是 `dist-site/game.html`。普通开发、后端和独立导出继续使用根 `index.html`。
- Pages 只能静态托管；网站专用构建使用本机存档，不请求 `/api`。需要服务器存档时使用 Node.js 后端。不要将静态网站描述成已部署后端。
- 按改动运行相关验证。网站路径、入口、存档或发布行为变化时执行 `npm run test:site`；动力学或后端变化时执行 `npm run test:server`。源码或素材改变后重新导出最新游戏包，验证独立版本，保留前三阶段 ZIP。
- 发布后检查 Actions 部署结果与网站 `version.json` 的 Git 提交是否匹配。只有实际成功并验证公开响应后，才能声称网站已上线或同步。网络或权限阻止检查时，明确说明阻碍，继续完成不受影响的工作。
- 初次启用 Pages 需要仓库 Settings → Pages → Source 为 GitHub Actions，见 docs/WEBSITE.md。自动部署无需增加私有令牌；不读取或提交任何秘密、`data/`、环境配置或本机存档。
- 不向用户提供云机器的 localhost、工作区文件链接作为公开网站。对新版本提供公开网站入口，并保留 GitHub 下载作为离线入口。
