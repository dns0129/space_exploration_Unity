# Unity 星际探索开发

- 根目录是 Unity 2022.3 LTS 项目，使用内置渲染管线；`LegacyWeb/` 是源仓库快照。优先读取 README.md 与 docs/UNITY-PHYSICS.md。
- 对游戏玩法修改，运行相应的 Unity PlayMode 检查；对纯物理核心修改，运行 `dotnet run --project tools/PhysicsChecks -- .`。
- 缺少 Unity 编辑器时，可以执行纯 C# 检查，但必须明确说明没有运行实际 PhysX、Shader 与 Unity 构建；不要宣称通过了画面或帧率验收。
- 天文世界坐标必须保留双精度与系统参考系；PhysX 只接收局部米制坐标。原点平移不能修改速度或姿态。
- 地形图像与高度场许可来自 LegacyWeb/ASSETS.md 与 THIRD_PARTY_NOTICES.md；修改生成数据应优先修改 tools/import-world.mjs 并重新生成。
- 保留 LegacyWeb 的源代码，避免在物理迁移中无意改写。若明确修改网页版本，应遵循该目录下的原 AGENTS.md。
- Unity Assets 与场景的 .meta 文件必须一并提交，避免引用失效。不要提交 Library、Temp、Logs、node_modules、本机存档或密钥。
