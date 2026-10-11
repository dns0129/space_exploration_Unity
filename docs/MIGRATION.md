# 迁移范围与验证记录

来源：`https://github.com/dns0129/space_exploration`，main 提交 `d6fc6a9c1e2bb1229fe74538140bf9d4c485697d`。

## 文件对应

| 原项目 | Unity 版本 |
| --- | --- |
| `shared/world.json`、`surface.mjs`、高度场 | `tools/import-world.mjs` → `Assets/StreamingAssets/Voyager/` |
| `src/ship-dynamics.ts` | `Assets/Voyager/Runtime/ShipController.cs` |
| `src/walking-dynamics.ts`、`walking-physics.ts` | `AstronautController.cs`、`LocalTerrain.cs` |
| `shared/spatial-frame.mjs` | `Double3.cs` 与 `ShipController` 的局部原点 |
| `src/flight-store.ts` | `VoyagerSave.cs`，独立 Unity JSON 格式 |
| 推进器、追踪相机、导航 UI | `VoyagerPresentation.cs` 的 Unity 初版 |

原网页源文件、后端、图片与测试完整保存在 `LegacyWeb/`。排除原 Git 历史和 `downloads/` 下的历史 ZIP；它们仍在源仓库。原 `.github` 配置也在 `LegacyWeb/.github/`，不会作为本仓库的根工作流执行。

## 已实现与后续范围

当前 Unity 场景包括天体导航、自由飞行、惯性与辅助驾驶、近地碰撞、自动着陆、起飞、地表放置、离舱徒步、径向重力跳跃、相机、推力粒子、保存恢复、暂停和跃迁计时。

保留全部 56 个天体数据，不代表原版全部场景效果已移植：星舰内探索与驾驶、移动星舰存档、手机触控、照片观测选点、原版完整天空/云层/土星环/黑洞透镜/碎裂天体着色器仍在 `LegacyWeb`。Unity 场景使用基础球体、图片和局部地形呈现；照片导出包含当前相机画面。跨系统跃迁在航道计时结束时切换参考系，同系统跃迁有安全包络中止，没有原版绕行与途中取消逻辑。

目前面向桌面与编辑器。`WorldCatalog` 从 `StreamingAssets` 读取本地文件，因此 Android/WebGL 需要改用平台兼容的异步资源读取，当前不能直接宣称已支持。所有贴图位于 Resources，仅在天体角尺寸达到阈值时加载，但当前没有卸载策略或设备预算；Profiler 测量后再确定资源策略。

## 检查结果

- C# 物理核心：244 项检查通过，包括 224 个原版地形对照样本、重力衰减、高速碰撞、推进档位、有限加速度和原点平移。地形最大差约 `1.4 × 10⁻¹¹ m`。
- 原网页复制代码：132 个后端/动力学测试通过，并完成 TypeScript 与 Vite 构建。
- Unity Runtime C#：使用 UnityEngine 2021.3.33 API 引用执行额外 .NET 编译检查；零错误、零警告。项目仍以 2022.3 LTS 为目标，正式编译以编辑器导入为准。
- Unity PlayMode：已添加真实地面接触、月球跳跃与存档验收测试；云环境没有 Unity 编辑器和许可证，尚未运行。
- Unity Shader、编辑器脚本、桌面构建、画面、帧率与连续碰撞实际接触：仍需 Unity 2022.3 编辑器验收。

原网站未修改或重新部署；本仓库提供独立 Unity 项目。运行结果必须与验证范围一起理解。
