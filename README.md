# 星际探索 · Unity 物理重构版

本仓库由 `dns0129/space_exploration` 的 `d6fc6a9c1e2bb1229fe74538140bf9d4c485697d` 复制而来。根目录是 Unity **2022.3 LTS** 项目，原网页代码、后端、测试、图片和许可记录保存在 `LegacyWeb/`，便于对照和继续迁移。GitHub 仓库的现有名称是 `space_exploration_Unity`。

## 运行

1. 在 Unity Hub 安装 **2022.3.62f1**，选择 **Add project from disk**，打开本仓库根目录。
2. 等待包和图片导入，打开 `Assets/Voyager/Scenes/Exploration.unity`，点击 **Play**。
3. 使用左侧导航选择天体，按 **J** 跃迁；也可以选择“快速抵达目标附近”或“从目标地表出发”。后者便于直接体验着陆、离舱、不同重力下的跳跃。

若要重新生成场景，使用 **Voyager → Rebuild Exploration Scene**。使用内置渲染管线与旧 Input Manager；不要在此项目中切换为仅启用新 Input System。已准备桌面与 WebGL 平台代码，浏览器版本需要先生成真实 Unity 构建，步骤见 [安装 Unity 与 GitHub Pages 发布](docs/WEBGL-DEPLOY.md)。

| 操作 | 按键 |
| --- | --- |
| 前后推力、平移、升降 | W/S、A/D、R/F |
| 转向、俯仰、翻滚 | 方向键、Q/E |
| 加速响应、刹车 | Shift、空格 |
| 对准目标、驾驶辅助 | T、G |
| 跃迁、自动着陆/起飞 | J、L |
| 离舱/返舱、切换视角 | E、C |
| 徒步、奔跑、跳跃 | WASD、Shift、空格 |
| 保存、恢复、暂停 | F5、F9、Esc |
| 摄影、保存照片 | P、Enter |

桌面存档和照片位于 Unity 的 `Application.persistentDataPath`；WebGL 存档保存在当前浏览器，照片直接下载，保存/恢复快捷键为 **K / O**。每 20 秒航行时间自动保存一次；暂停和跃迁中不自动覆盖存档。Unity 存档与原网页存档使用不同格式，不自动互通。失去窗口焦点会暂停，按 Esc 或点击“继续航行”。

## 本次重构

- **天体与地形**：导入原版全部 56 个天体和 7 个航区的坐标、半径、地表重力、可着陆规则；35 份共用高度场与原版采样规则一致。保留实测图片和概念图的来源说明。
- **近地飞行**：使用 PhysX `Rigidbody`、`BoxCollider`、力与力矩计算飞船运动，配合连续碰撞检测、接触摩擦、辅助驾驶、惯性漂移、降落和起飞。船体使用正常的米制尺寸。
- **远距飞行**：保留双精度系统坐标，并以整段运动的球体扫掠处理高速穿越；进入保守地形包络时降速并切换到局部 PhysX 场景。不能把天文尺度坐标直接交给单精度 PhysX。
- **地表徒步**：动态刚体和胶囊碰撞，径向重力、地面接触查询、坡度限制、空中控制、按键边沿跳跃、返舱距离检查。极低重力天体保留宇航服回落辅助。
- **精度**：局部原点在约 1000 m 处重置，仅平移物体和地形，不改速度或旋转。人物脚下的 MeshCollider 与可见地形使用同一批顶点。
- **物理节奏与效果**：统一以 120 Hz 模拟，暂停时不推进物理；推进器粒子随推力变化，相机视野随跃迁改变，第三人称人物相机执行地形扫掠。
- **存档**：保存双精度位置、速度、姿态、着陆与徒步状态，检查非法坐标、天体和高度，并用临时文件替换保存文件。

详见 [物理设计与方案优点](docs/UNITY-PHYSICS.md) 和 [迁移范围及验证](docs/MIGRATION.md)。

## 验证

无需 Unity，可以安装 .NET 8 并运行物理核心检查：

```sh
dotnet run --project tools/PhysicsChecks -- .
```

重新从原代码生成世界与高度场：

```sh
node tools/import-world.mjs
python3 tools/unity-meta.py
```

在 Unity **Window → General → Test Runner → PlayMode** 中运行 `PhysicsAcceptanceTests`，验证真实 PhysX 地面接触、月球跳跃、原点平移和徒步存档恢复。当前云环境没有 Unity 编辑器；已运行的检查与尚未运行的检查见迁移记录，不能以 .NET 核心检查代替 Unity 运行验收。

Linux 桌面构建需要在 Unity Hub 安装相应模块：

```sh
mkdir -p Builds
Unity -batchmode -projectPath "$PWD" -executeMethod Voyager.Editor.VoyagerProjectSetup.BuildLinux -quit -logFile Builds/unity-build.log
```

其他桌面平台使用 **File → Build Settings**，添加 `Exploration` 场景后选择平台。WebGL 使用 **Voyager → Build WebGL for GitHub Pages**，再运行 `node tools/publish-webgl.mjs`。当前尚无真实 WebGL 构建，网站尚未上线；完整安装、首次启用 Pages 和发布步骤见 [浏览器发布说明](docs/WEBGL-DEPLOY.md)。原网页仓库及公开网站继续独立维护。

图片及原代码的第三方依赖声明见 [素材说明](LegacyWeb/ASSETS.md) 和 [第三方声明](LegacyWeb/THIRD_PARTY_NOTICES.md)。历史下载 ZIP 继续保留在原仓库；此仓库复制源码与运行素材，不重复历史发行包及 Git 历史。
