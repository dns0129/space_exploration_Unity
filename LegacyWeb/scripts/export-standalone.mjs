import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { build } from "vite";

const project = fileURLToPath(new URL("../", import.meta.url));
const filename = "voyager-warp.html";
// The standalone browser and optional backend read one embedded height dataset.
// Keep their physical geology identical without duplicating several MiB in ZIP.
const terrainModule = await readFile(join(project, "shared/terrain-fields.mjs"), "utf8");
const rasterDeclaration = terrainModule.match(/^const rasterDefinitions = (\{[^\n]+\});$/m);
if (!rasterDeclaration) throw new Error("Canonical terrain format changed; update the export adapter.");
const terrainJson = rasterDeclaration[1];
JSON.parse(terrainJson);
const terrainMarker = '<script id="canonical-height-data" type="application/json">';
const backendTerrainModule = 'import { openSync, readSync, closeSync } from "node:fs";\n' + terrainModule.replace(rasterDeclaration[0], `
const rasterDefinitions = (() => {
  const file = openSync(new URL("../${filename}", import.meta.url), "r");
  const chunk = Buffer.alloc(256 * 1024), marker = ${JSON.stringify(terrainMarker)};
  let prefix = "";
  try {
    for (;;) {
      const size = readSync(file, chunk, 0, chunk.length, null);
      if (!size) throw new Error("Canonical terrain dataset is missing from the game document.");
      prefix += chunk.toString("utf8", 0, size);
      const start = prefix.indexOf(marker);
      if (start < 0) { prefix = prefix.slice(-marker.length); continue; }
      const end = prefix.indexOf("</script>", start + marker.length);
      if (end >= 0) return JSON.parse(prefix.slice(start + marker.length, end));
    }
  } finally { closeSync(file); }
})();`);
// Shared collision heights are embedded in code. Original Earth DEM images
// remain in use; retired AI detail and the replaced panorama are omitted.
const retiredTextures = new Set(["surface-material-atlas.jpg", "earth-terrain-8k.png", "centauri-milky-way-4k.jpg"]);
const textures = {};
for (const file of (await readdir(join(project, "public/textures"))).filter((file) => /\.(jpg|png)$/.test(file) && !retiredTextures.has(file)).sort()) {
  const bytes = await readFile(join(project, "public/textures", file));
  const type = file.endsWith(".png") ? "image/png" : "image/jpeg";
  textures[file] = `data:${type};base64,${bytes.toString("base64")}`;
}

const result = await build({
  configFile: false,
  root: project,
  base: "./",
  publicDir: false,
  plugins: [
    {
      name: "standalone-local-textures",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/shared/terrain-fields.mjs")) return {
          code: code.replace(rasterDeclaration[0], 'const rasterDefinitions = JSON.parse(document.getElementById("canonical-height-data").textContent);'),
          map: null,
        };
        if (!id.endsWith("/src/planet-scene.ts")) return;
        const location = "`${import.meta.env.BASE_URL}textures/${file}`";
        if (!code.includes(location))
          throw new Error("Texture loader changed; update the export adapter.");
        return {
          code: `const inlineTextureAssets = ${JSON.stringify(textures)};\ninlineTextureAssets["earth-terrain-8k.png"] = inlineTextureAssets["earth-terrain-4k.png"];\n` + code.replaceAll(location, "inlineTextureAssets[file]"),
          map: null,
        };
      },
    },
  ],
  build: {
    write: false,
    modulePreload: false,
    reportCompressedSize: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

if (Array.isArray(result)) throw new Error("Expected one application output.");
const chunks = result.output.filter((item) => item.type === "chunk");
if (
  chunks.length !== 1 ||
  chunks[0].imports.length ||
  chunks[0].dynamicImports.length
) {
  throw new Error(
    "Standalone application must have no external JavaScript imports.",
  );
}
const htmlAsset = result.output.find(
  (item) => item.type === "asset" && item.fileName === "index.html",
);
const cssAsset = result.output.find(
  (item) => item.type === "asset" && item.fileName.endsWith(".css"),
);
if (!htmlAsset || !cssAsset)
  throw new Error("Application HTML or styles are missing.");
const source = (item) =>
  typeof item.source === "string"
    ? item.source
    : Buffer.from(item.source).toString("utf8");
let html = source(htmlAsset);
const script = chunks[0].code.replace(/<\/script/gi, "<\\/script");
html = html.replace(
  /<script\b[^>]*\bsrc="[^"]+"[^>]*>\s*<\/script>/,
  () => `${terrainMarker}${terrainJson.replace(/</g, "\\u003c")}</script><script type="module">${script}</script>`,
);
html = html.replace(
  /<link\b(?=[^>]*\brel="stylesheet")[^>]*>/,
  () => `<style>${source(cssAsset)}</style>`,
);
const favicon = await readFile(join(project, "public/favicon.svg"));
html = html.replace(
  /<link\b(?=[^>]*\brel="icon")[^>]*>/,
  () =>
    `<link rel="icon" href="data:image/svg+xml;base64,${favicon.toString("base64")}">`,
);

const instructions = `远航 VOYAGER · 太阳系、半人马座 α、巴纳德星、参宿四、回声裂隙、地表与空间站探索

立即驾驶：解压后将 voyager-warp.html 拖入 Chrome 或 Edge。
点击顶部“自由航行”，从当前行星附近出发。
行星观测站也可选择“放置飞船”或“放置人物”，再点击星球上的位置，直接停泊或进入徒步，Esc取消选点；没有固体地表的天体禁用放置。
相机按钮或P开启摄影，画布覆盖全屏并隐藏全部界面与返舱光环；Enter保存PNG照片，P/Esc或双击画面退出，手机双击退出，也可用系统截图。
W 前进，S 减速（停稳后倒车），A/D 平移，R/F 升降，Q/E 翻滚，方向键转向；触屏按住拖动，松手回正。
Shift 加速，空格刹车，C 切换座舱/外部视角，J 启动跃迁，L 自动着陆/起飞/中止。手机使用触屏驾驶按钮。
选择并靠近岩石行星或卫星，按 L 连续下降并展开起落架；着陆后 L 或 R 起飞，升至离地 2 km 恢复手动驾驶。空格或手动操纵中止自动下降/起飞，暂停冻结进度。太阳和巨行星没有可着陆的固体地表。
落地后按 E 离舱；WASD 行走，Shift 奔跑，空格跳跃，方向键或拖动看向，C 切换第一/第三人称。落地且距离停泊点12m内按E返舱，返舱后再L/R起飞。不同天体重力改变跳跃高度、滞空与抓地；极低重力有宇航服回落辅助。人物位置、速度、腾空和视角支持保存恢复。徒步场景用24m登陆艇表示返舱入口，飞行船停泊坐标不变。
地球空间站位于向阳面2400km高度，跨度360km，拥有双层居住环、玻璃观测舱、主控塔楼及三座青蓝/琥珀发光停泊港。自由航行选择“空间站”，按J跃迁或自行靠近；跃迁结束、引擎冷却且距站体边缘1800km内，按L或点击停泊按钮进入停泊舱。WASD行走、Shift奔跑、空格跳跃，方向键或拖动查看四周，手机使用触屏按钮；沿廊道探索主控室和观测舱，导览图显示位置。落地并回到停泊入口12m内，按E或点击“返回飞船”继续航行。暂停冻结舱内运动；本机及包内后端存档均支持舱内人物位置、视角与空间站访问状态。观测页的地表放置不用于空间站。
地表网格、着陆与徒步碰撞继续共用高度场：地球为GEBCO高度和海陆分类，其他固体天体为影像推断高度或固定程序坑场。原有有效着陆、徒步存档仍可恢复。轨道材质恢复到增强升级前版本。
地球100km已进入稀薄大气，蓝色地平线与天空散射随下降逐步增强、星空逐步淡出，晨昏出现暖色散射；外部镜头保持飞船附近的高度。光学密度为游戏美术参数，大气阻力仍按稀薄高空密度计算。辅助驾驶补偿近地重力；关闭后需自行施加升力。
导航目标可收起，引擎控制独立放在下方。一根滑条选择五档目标航速：1–100、100–1000、1000–10000、10000–50000、50000–150000km/s，默认100km/s；档位按钮可快速选择区间。飞船逐渐加减速接近目标，换档或拖动滑条不瞬间跳速，Shift增强推力响应，空格刹车。
只有离实际固体地表10km以内（含10km）时，滑条切换为1–1000m/s低空引擎，默认1000m/s；离开后恢复太空预设并平滑加速。大气与朝向不再额外限制太空档位。低空与太空预设分别保存，兼容旧存档。O轨道按钮由新滑条替代；自动着陆、起飞、实体碰撞与徒步继续可用。
卫星导航提供月球及木星 4、土星 8、天王星 5、海王星 8 颗主要卫星。火星和月球使用原生8K影像，触屏、低内存或GPU纹理上限不足时使用4K；其他有探测器影像的卫星使用 4K/2K 实测全球影像，海王星小卫星与海卫二使用 4K 高清概念图；半径及平均轨道距离采用公里比例，位置为静态示意。减速时显示琥珀色制动脉冲。
“恒星系统”切换太阳系、半人马座 α、巴纳德星、参宿四、回声裂隙或暗渊黑洞的导航目标，再选择天体。半人马座包含南门二 A/B、比邻星，以及比邻星 b、c、d；c/d 标记为候选行星。系外行星的半径、地表与大气是游戏示意。
回声裂隙为原创虚构航区：蓝白脉冲星的等离子纹理、白色亮边、细长双极喷流与倾斜尘雾环、青金色气态巨行星维尔、水系岩石卫星塔拉萨、干燥岩石卫星烬岩，以及保留圆形球壳、带有真实主裂带与分支断层、红橙熔融内层和同材质曲面碎片的残冕行星与裂片卫星。塔拉萨与烬岩可放置飞船或人物、着陆与徒步，地貌着色和碰撞共用固定高度场。脉冲星为便于观看而艺术放大；巨行星、脉冲星与碎裂天体不能着陆。银河全景经过球面连续重构并叠加冷青紫尘埃，保留原有画风。航区、距离、轨道、重力与水系热源均为虚构，不是天文观测数据。
巴纳德航区包含一颗M型红矮星与d/b/c/e四颗已确认近轨道行星；公转周期约2.34/3.15/4.12/6.74天。原生8K艺术表面与4K兼容版共用固定球面地貌，四颗行星可着陆、徒步和存档；半径、材质、重力与轨道方位均为示意，无实测地表影像，不加入旧233天候选。暖色照明贯通观测、驾驶与地表，银河仍沿用现有8K/4K全景。
参宿四目前仅包含一颗红超巨星，半径约 764 个太阳半径，距离约 548 光年；参数仍有观测不确定性。原生 8K 表面表现巨型对流胞，紧凑设备使用 4K 版本；均为原创艺术示意，恒星不能着陆。参宿四复用银河全景并单独设置方向与亮度。
半人马座三颗恒星与比邻星 b/c/d 使用 4K 高清概念图，不是实测照片。各航区共享真实8K/4K银河全景，实际跃迁与存档恢复会自动切换观察方向与亮度；程序星点是美术细节，不是天文星表。跨系统距离以光年显示。
原有43个球形天体沿用原有影像和程序材质。新增回声裂隙6个原创程序天体与暗渊黑洞，加上巴纳德星及其四颗行星，共56个目的地（含空间站）。黑洞拥有三维吸积盘与视角相关的艺术透镜光弧；8K/4K银河灰褐尘埃与密集细星共用视线偏折，靠近阴影时弯曲、拉伸为环向星弧，远处恢复普通星空。黑洞没有固体地表，禁止登陆。6倍阴影半径处是游戏安全屏障，不模拟广义相对论动力学。地球保留原有原生16K观测影像，火星和月球保留8K/4K影像。固体天体近地表只绘制一个完整封闭球面，在观察者附近集中细分网格；碎裂天体使用独立残骸几何。基础影像和地表碰撞高度数据随包提供，断网可用。
地球具有1.6–6.5km低空积云、7.8–15.5km入气云层和21km薄卷云，蓝天、浅色地平线、太阳盘与晨昏散射连续衔接。星球内和太空使用独立场景，每帧只更新当前模式；星球内暂停无关全球模型，允许当前天体的基础影像和材质更新，完整地表球面按需重新细分。精细船体有实体装甲缝、曲面座舱、涡轮喷口与柔和尾焰。
飞行船体长10km，与星球共用公里比例；离地2km内平滑切换为24m地表登陆艇，停泊与徒步使用相同地面比例，外部镜头可看清完整船体，位置和地表碰撞保持一致。
点击天体导航选择目的地；“启动跃迁”蓄能、穿越航道，在星球仍很小时开始直线减速，星球随实际距离连续放大，航道光效逐渐淡出，可暂停或中止。末段保持朝向和翻滚，不自动调平或转向地平线。抵达侧保留出发方向；岩石行星通常距表面约 1100 km，巨行星和土星环系保留安全余量。
可以暂停航行、保存与恢复；无需服务器的独立 HTML 使用本机存档。

后端模式（服务端存档）：
安装 Node.js 24 LTS，然后在本目录运行：
node server/server.mjs --standalone
Windows 可双击“启动航行.bat”；macOS/Linux 可执行 bash 启动航行.sh。
服务启动后在浏览器访问 http://127.0.0.1:3000/
后端和游戏全部随包提供，不需要 npm 安装依赖。
航行存档保存在 data/ 中，浏览器用自己的会话识别存档。
不要删除浏览器会话 Cookie；重新启动服务器后仍可恢复同一浏览器的存档。

原生16K地球分块、原有天体影像、8K/4K地球图层与银河全景、太阳、行星、卫星和半人马座天体的基础贴图、程序和样式已内嵌；放大时使用平滑过滤与细节叠加。浏览器需要WebGL 2与图形加速；超清、高清与标准均按持续帧耗时自动调整画面分辨率；性能不足时可选择标准画质。
天体半径和平均日距使用真实公里比例；太阳系行星和谷神星采用参考轨道倾角与升交点方向，小行星带具有立体分布。卫星随母星平移，旧版天体附近的航行、着陆和徒步存档支持布局迁移。方位仍是静态圆轨道示意，不是实时星历，尚未模拟公转或真实轨道力学；飞船采用简化惯性、驾驶辅助与实体碰撞。
银河全景与各天体使用影像贴图及简化着色；素材来源、修改和许可见 ASSETS.md 与 THIRD_PARTY_NOTICES.md。
源码与素材来源：https://github.com/dns0129/space_exploration
`;
const windowsStart =
  '@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\nwhere node >nul 2>nul\r\nif errorlevel 1 (echo 请先安装 Node.js 24 LTS & pause & exit /b 1)\r\necho 浏览器打开 http://127.0.0.1:3000/\r\nnode server/server.mjs --standalone\r\npause\r\n';
const unixStart =
  '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\necho "Open http://127.0.0.1:3000/ after the server starts."\nexec node server/server.mjs --standalone\n';

// ZIP records keep export portable without Python or an archiver.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function archive(entries) {
  const files = [],
    directory = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const path = Buffer.from(name);
    const bytes = Buffer.from(content);
    const compressed = deflateRawSync(bytes, { level: 9 });
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); // UTF-8 filenames.
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x5d42, 12); // 2026-10-02, deterministic export date.
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(path.length, 26);
    files.push(header, path, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    header.copy(central, 6, 4, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, path);
    offset += header.length + path.length + compressed.length;
  }
  const index = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, index, end]);
}

await mkdir(join(project, "dist-standalone"), { recursive: true });
await writeFile(join(project, "dist-standalone", filename), html);
const zip = archive([
  [filename, html],
  ["中文打开说明.txt", instructions],
  ["启动航行.bat", windowsStart],
  ["启动航行.sh", unixStart],
  ["server/server.mjs", await readFile(join(project, "server/server.mjs"))],
  [
    "shared/flight-state.mjs",
    await readFile(join(project, "shared/flight-state.mjs")),
  ],
  ["shared/world.json", await readFile(join(project, "shared/world.json"))],
  ["shared/surface.mjs", await readFile(join(project, "shared/surface.mjs"))],
  ["shared/spatial-frame.mjs", await readFile(join(project, "shared/spatial-frame.mjs"))],
  ["shared/station-layout.mjs", await readFile(join(project, "shared/station-layout.mjs"))],
  ["shared/echo-terrain.mjs", await readFile(join(project, "shared/echo-terrain.mjs"))],
  ["shared/terrain-fields.mjs", backendTerrainModule],
  ["shared/propulsion.mjs", await readFile(join(project, "shared/propulsion.mjs"))],
  ["ASSETS.md", await readFile(join(project, "ASSETS.md"))],
  ["THIRD_PARTY_NOTICES.md", await readFile(join(project, "THIRD_PARTY_NOTICES.md"))],
  ["public/textures/provenance.json", await readFile(join(project, "public/textures/provenance.json"))],
]);
// Full-resolution downloads are generated into the Pages artifact. Git's
// 100 MiB blob limit must not force the offline runtime to lose its imagery.
// Keep the previously tracked downloads/ archives unchanged.
await writeFile(join(project, "dist-standalone/voyager-warp.zip"), zip);
console.log(
  `Exported ${filename} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MiB) and dist-standalone/voyager-warp.zip (${(zip.length / 1024 / 1024).toFixed(1)} MiB).`,
);
