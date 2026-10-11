# 安装 Unity 并发布浏览器游戏

这里发布的是 Unity WebGL 游戏。当前仓库有平台适配代码、加载页面和发布流程，尚未生成实际 WebGL 构建，因此网站还没有上线。首次构建需要一台安装 Unity 的电脑。

## 1. 安装工具

1. 从 [Unity 官方下载页](https://unity.com/download) 安装 Unity Hub，登录自己的 Unity 账号，在 Hub 中激活适合自己的许可。符合资格的个人用户可使用 Unity Personal，具体资格按 Unity 当前条款判断。
2. 在 [Unity 2022.3.62f1 官方发布页](https://unity.com/releases/editor/whats-new/2022.3.62f1) 点击 **Install**，通过 Hub 安装该编辑器，勾选 **WebGL Build Support**。已安装编辑器时，在 Hub 的编辑器齿轮菜单选择 **Add modules** 补装。
3. 安装 [Git](https://git-scm.com/downloads) 和 [Node.js LTS](https://nodejs.org/en/download)（22 或更高版本）。关闭并重新打开 Hub，确保它能在 PATH 中找到 Git。发布脚本仅使用 Node 内置模块，无需安装网页开发依赖。
4. 使用 Git 克隆项目并获取最新 main：

```sh
git clone https://github.com/dns0129/space_exploration_Unity.git
cd space_exploration_Unity
```

已有副本时，先保存自己的修改，再更新 main。Git 提交需要配置自己的姓名、邮箱；推送时使用 GitHub 的正常登录方式，不要把密码、令牌或 Unity 许可证提交进仓库。

## 2. 在 Unity 中构建

1. 在 Hub 选择 **Add → Add project from disk**，打开项目根目录；不要选择 `LegacyWeb`。
2. 等待导入完成，打开 `Assets/Voyager/Scenes/Exploration.unity`。先在 **Play** 中确认能飞行、选择天体、着陆和离舱。
3. 在 **File → Build Settings** 中选择 **WebGL → Switch Platform**。保持项目使用旧 Input Manager 与内置渲染管线。
4. 第一次导入可能补充 ProjectSettings 或更新素材 `.meta`。先查看 `git status`，将需要保留的导入结果提交并推送 main，确保构建前工作区干净。`Library`、`Builds` 和其他临时目录已忽略。
5. 在菜单点击 **Voyager → Build WebGL for GitHub Pages**，等待编译结束。输出目录为 `Builds/WebGL/`，包括 `Build/`、`StreamingAssets/`、`index.html` 和 `build-info.json`。

菜单会自动选择 Voyager 加载页面、IL2CPP、单线程 WebAssembly、按内容哈希命名的资源和未压缩输出。GitHub Pages 无法设置 Unity Brotli/gzip 与跨来源隔离所需的 HTTP 响应头，所以不要自行开启这些设置。未压缩版本下载体积较大，是这次简单发布方案的代价。

编辑器路径已在 PATH 中时，也可运行：

```sh
Unity -batchmode -projectPath . -buildTarget WebGL -executeMethod Voyager.Editor.VoyagerProjectSetup.BuildWebGL -quit -logFile Builds/unity-webgl.log
```

## 3. 启用 GitHub Pages 并发布

1. 打开 [本仓库 Pages 设置](https://github.com/dns0129/space_exploration_Unity/settings/pages)，将 **Build and deployment → Source** 选为 **GitHub Actions**。这一步只需设置一次；当前连接没有管理仓库 Pages 设置的权限，需由仓库所有者操作。
2. 在仓库根目录的终端运行：

```sh
node tools/publish-webgl.mjs
```

脚本核对源提交、Unity 版本、WebAssembly 文件和所有地形，生成带 SHA-256 清单的网页，然后正常推送到 `gh-pages` 分支，保留该分支 Git 历史。`gh-pages` 专门保存发布产物，脚本每次替换其中的网站文件。它不强推或改动 main 工作区；没有真实构建时会直接报错。

3. 在 [Deploy Unity WebGL game](https://github.com/dns0129/space_exploration_Unity/actions/workflows/deploy-pages.yml) 查看发布结果。它部署 `site/`，核对公开版本和文件地址，并用真实浏览器检查 Unity 启动、地形加载，以及刷新页面后的存档恢复。检查记录与截图可在工作流产物中下载。
4. 工作流成功后，游戏地址为：**https://dns0129.github.io/space_exploration_Unity/**。地址大小写应保持一致。

Unity 只在本机编译，所以这条发布路径不需要在 GitHub 保存 Unity 账号密码或许可证。若要以后完全自动编译，需要另外配置合法的 Unity 构建许可或已激活的构建机。

## 浏览器操作与限制

- 用桌面浏览器、键盘和鼠标运行；当前没有移植手机触控。点击画面获取输入焦点，切出页面后点击“继续航行”。
- WebGL 的存档快捷键改为 **K / O**，避免 F5 刷新网页；也可点击游戏内保存、恢复按钮。浏览器存档与桌面文件存档分开，清除网站数据会删除浏览器存档。
- 摄影模式 **P → Enter** 下载 PNG。首次照片下载可能需要允许浏览器下载。
- 初次启动会下载游戏与地形；下载错误显示在加载页，可刷新重试。网页发现新版本时提示先保存再刷新。
- Unity WebGL、着色器、真实 PhysX 和画面仍需正式构建验证。目前云环境只能完成 C# 编译、纯物理检查和加载页检查，不能将它们算成 Unity 浏览器运行验收。

## 常见问题

| 提示 | 处理 |
| --- | --- |
| 缺少 WebGL Build Support | 在 Hub 为 **2022.3.62f1** 补装 WebGL 模块。 |
| No Unity WebGL build found | 先执行 Voyager 构建菜单；仅源码不能直接在浏览器运行。 |
| contains uncommitted changes / different commit | 提交推送修改，再重新构建，保证网站版本对应源码。 |
| configure-pages 报 Pages site not found | 在 Pages 设置将 Source 选为 GitHub Actions，再在 Actions 中重跑失败的发布任务。 |
| 文件超过 GitHub 单文件限制 | 调低贴图导入尺寸并重建；脚本会在推送前指出过大的文件。 |
| 浏览器黑屏或内存错误 | 先检查开发者控制台与 Unity 构建日志，使用较新的桌面浏览器；后续需要根据实测降低贴图与地形预算。 |
