import type { RenderQuality } from "./earth-detail";
import "./style.css";
import { watchSiteVersion } from "./site-version";
import { FlightInterface } from "./flight-ui";
import { SolarScene } from "./planet-scene";
import { surfaceMapLabel } from "./body-textures";
import type { SurfacePlacement, View } from "./planet-scene";
import { surfaceProfile } from "../shared/surface.mjs";
import { SOLAR_SYSTEM, PRIMARY_BODIES, EXPLORATION_BODIES, MOONS, CENTAURI_BODIES, BETELGEUSE_BODIES, ECHO_RIFT_BODIES, BLACK_HOLE_BODIES, BARNARD_BODIES, STAR_SYSTEMS, getBodySystem, getSystemGroup, getBody, isBodyId } from "./solar-system";
import type { BodyId, Layer } from "./solar-system";

const icons: Record<string, string> = {
  orbit:
    '<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="4"/><path d="m20 4 1 1"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5z"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 1 1 4 2l-1.5 1.5V13m0 3v.01"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  moon: '<path d="M20 13a8 8 0 0 1-9-9 9 9 0 1 0 9 9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  camera: '<path d="M4 6h4l2-3h4l2 3h4v14H4z"/><circle cx="12" cy="13" r="4"/>',
  ship: '<path d="m12 3 4 8 5 6-7-2-2 6-2-6-7 2 5-6z"/>',
  person: '<circle cx="12" cy="5" r="3"/><path d="M8 21v-7H5v-3l4-2h6l4 2v3h-3v7m-4-6v6"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const publicSite = import.meta.env.VITE_PUBLIC_SITE === "true";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="observatory">
    <header class="header">
      <a class="brand" href="${publicSite ? `${import.meta.env.BASE_URL}index.html` : "#planet=earth"}" aria-label="${publicSite ? "星际探索首页" : "远航首页"}">${icon("orbit")}<span>${publicSite ? "星际探索" : "远航"} <b>VOYAGER</b></span></a>
      <nav class="main-nav" aria-label="主导航"><button id="mode-observe" class="nav-active" aria-pressed="true">行星观测</button><button id="mode-flight" class="scene-control" aria-pressed="false" disabled>自由航行</button></nav>
      <div class="header-tools"><span class="connection"><i></i><span id="connection-text">正在连接观测站</span></span><button class="icon-button scene-control" id="photo-mode" aria-label="摄影模式" aria-pressed="false" title="摄影模式（P）· Enter 保存照片 · Esc 或双击画面退出" disabled>${icon("camera")}</button><button class="icon-button" id="help" aria-label="操作指南" title="操作指南（H）">${icon("help")}</button></div>
    </header>

    <nav class="planet-rail" aria-label="太阳系天体">
      <span class="rail-label">SOLAR<br>SYSTEM</span>
      ${[...PRIMARY_BODIES, ...EXPLORATION_BODIES, ...CENTAURI_BODIES, ...BETELGEUSE_BODIES, ...ECHO_RIFT_BODIES, ...BLACK_HOLE_BODIES, ...BARNARD_BODIES].map((planet, index) => `<button data-body="${planet.id}" class="planet-item ${planet.id === "earth" ? "active" : ""}" style="--planet-color:${planet.color}" aria-label="${planet.name}，${planet.id === "earth" ? "当前观测天体" : "切换观测"}" ${planet.id === "earth" ? 'aria-current="page"' : ""} title="${planet.name} · ${planet.english}"><span class="planet-dot ${planet.id}"></span><span class="planet-name">${planet.id === "ceres" ? "小行星带" : planet.id === "earth-station" ? "星舰" : planet.name}</span><span class="planet-order">${String(index).padStart(2, "0")}</span></button>`).join("")}
      <span class="rail-progress"><b>${SOLAR_SYSTEM.length}</b> / ${SOLAR_SYSTEM.length}</span>
    </nav>

    <div class="destination-selectors"><label class="system-navigation">恒星系统 <select id="star-system" class="scene-control" aria-label="恒星系统" disabled><option value="solar">太阳系</option><option value="alpha-centauri">半人马座 α</option><option value="betelgeuse">参宿四</option><option value="barnard">巴纳德星</option><option value="echo-rift">回声裂隙 · 虚构</option><option value="black-hole">黑洞星系 · 暗渊</option></select></label>
    <label class="satellite-navigation">卫星导航 <select id="satellite-target" class="scene-control" aria-label="卫星导航" disabled><option value="">选择卫星</option>${["earth", "jupiter", "saturn", "uranus", "neptune"].map(parent => `<optgroup label="${getBody(parent as BodyId).name}系统">${MOONS.filter(moon => moon.parentId === parent).map(moon => `<option value="${moon.id}">${moon.name} · ${moon.english}</option>`).join("")}</optgroup>`).join("")}</select></label></div>
    <main class="main">
      <aside class="planet-info" aria-label="地球信息">
        <div class="eyebrow"><span class="tiny-line"></span>我们的蓝色家园</div>
        <h1>地球<span>EARTH</span></h1>
        <div class="planet-tags"><span>岩石行星</span><span>宜居带</span></div>
        <p class="description">在浩瀚宇宙中，<br>一颗承载生命的蓝色星球。<br>你的星际旅程，从这里开始。</p>
        <dl class="facts"><div><dt>平均半径</dt><dd>6,371 <small>km</small></dd></div><div><dt>距太阳</dt><dd>1.496 <small>亿 km</small></dd></div><div><dt>公转周期</dt><dd>365.25 <small>天</small></dd></div><div><dt>地轴倾角</dt><dd>23.44<small>°</small></dd></div></dl>
        <button class="primary-button scene-control" data-view="close" disabled>进入近地轨道 ${icon("arrow")}</button>
        <span class="milestone">FIRST DESTINATION <i></i> 第 01 站</span>
      </aside>

      <section class="space-stage" id="space-stage" aria-label="地球观测场景">
        <div class="canvas-host" id="canvas-host"></div>
        <div class="scene-coordinate top-coordinate"><span>SECTOR 001</span><span>太阳系 · 地球</span></div>
        <div class="sun-label">${icon("sun")}<span>太阳光方向</span><i></i></div>
        <div class="scene-coordinate earth-caption"><i></i><span>TERRA / SOL III</span></div>
        <div class="reticle reticle-top"></div><div class="reticle reticle-bottom"></div>
        <div class="loading-overlay" id="loading-overlay" role="status" aria-live="polite"><div class="loader-orbit"></div><span id="loading-text">正在展开地球 · 0%</span><div class="loading-track"><i id="loading-progress"></i></div><small>准备高清地表与云层</small></div>
        <div class="error-panel" id="error-panel" role="alert" hidden><span class="eyebrow">观测暂时中断</span><h2>暂时无法打开地球场景</h2><p id="error-message"></p><button class="primary-button" id="retry">重新加载 ${icon("reset")}</button></div>
      </section>

      <div class="viewport-tools" aria-label="视角工具"><button class="icon-button scene-control" id="zoom-in" aria-label="放大" title="放大（+）" disabled>${icon("plus")}</button><button class="icon-button scene-control" id="zoom-out" aria-label="缩小" title="缩小（−）" disabled>${icon("minus")}</button><span class="tool-divider"></span><button class="icon-button scene-control" id="reset" aria-label="重置视角" title="重置视角（R）" disabled>${icon("reset")}</button><button class="icon-button" id="fullscreen" aria-label="全屏" title="全屏">${icon("expand")}</button></div>
      <div class="altitude"><span>观测高度</span><strong id="altitude">— <small>km</small></strong><span class="altitude-line"></span></div>
      <div class="interaction-hint"><span class="mouse-icon"></span> 拖动环绕 <i>·</i> 滚轮缩放 <i>·</i> <kbd>空格</kbd> 暂停自转</div>
      <button class="mobile-settings" id="mobile-settings" aria-controls="control-panel" aria-expanded="false">${icon("settings")} 观测设置</button>

      <section class="surface-placement" aria-label="地表放置">
        <div class="surface-placement-tools"><span class="control-label">地表放置</span><button id="place-ship" aria-pressed="false" disabled>${icon("ship")} 放置飞船</button><button id="place-person" aria-pressed="false" disabled>${icon("person")} 放置人物</button></div>
        <p id="surface-availability">选择对象，再点击星球上的位置</p>
        <div id="placement-hint" role="status" hidden><span id="placement-message"></span><button id="cancel-placement">取消 <kbd>Esc</kbd></button></div>
      </section>

      <section class="control-panel" id="control-panel" aria-label="观测设置">
        <div class="control-group views"><span class="control-label">观测视角 <small>VIEWPOINT</small></span><div class="segmented"><button class="scene-control selected" data-view="overview" aria-pressed="true" disabled>${icon("globe")} 全景</button><button class="scene-control" data-view="close" aria-pressed="false" disabled>${icon("compass")} 近地</button><button class="scene-control" data-view="night" aria-pressed="false" disabled>${icon("moon")} 夜景</button></div></div>
        <div class="control-group layers"><span class="control-label">画面图层 <small>LAYERS</small></span><div class="layer-switches"><button class="switch scene-control" role="switch" aria-checked="true" data-layer="clouds" disabled><span>云层</span><i></i></button><button class="switch scene-control" role="switch" aria-checked="true" data-layer="atmosphere" disabled><span>大气</span><i></i></button><button class="switch scene-control" role="switch" aria-checked="true" data-layer="stars" disabled><span>星空</span><i></i></button><button class="switch scene-control" role="switch" aria-checked="true" data-layer="rings" hidden disabled><span>环系</span><i></i></button></div></div>
        <div class="control-group rotation"><span class="control-label">星球自转 <small>ROTATION</small></span><div class="rotation-controls"><button class="icon-button scene-control" id="pause" aria-label="暂停自转" aria-pressed="false" disabled>${icon("pause")}</button><label class="speed-label" for="speed">演示速度</label><select class="scene-control" id="speed" aria-label="自转演示速度" disabled><option value="0.25">0.25×</option><option value="1" selected>1×</option><option value="5">5×</option><option value="10">10×</option></select></div></div>
        <div class="control-group quality"><label class="control-label" for="quality">渲染画质 <small>QUALITY</small></label><select class="scene-control" id="quality" disabled><option value="ultra">超清</option><option value="high">高清</option><option value="standard">标准</option></select></div>
      </section>
    </main>

    <footer class="footer"><span><i></i><span id="render-status">准备观测系统</span></span><span class="footer-center">探索，始于仰望。</span><span>离舱探索 · 阶段 06 <b>V 0.6</b></span></footer>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>

    <dialog id="help-dialog"><form method="dialog"><button class="icon-button dialog-close" aria-label="关闭操作指南">${icon("close")}</button></form><span class="eyebrow">WELCOME ABOARD</span><h2>从地球，望向宇宙。</h2><p class="dialog-intro">观测太阳、八颗行星及其主要卫星，或切换到自由航行驾驶飞船。航行时点击天体导航选择目标，用“对准目标”确定航向，再按 W 出发；按 J 启动跃迁引擎，蓄能后沿航线抵达。</p><dl class="guide"><div><dt>环绕观察</dt><dd>鼠标拖动 / 单指拖动 / 方向键</dd></div><div><dt>拉近与拉远</dt><dd>滚轮 / 双指捏合 / <kbd>+</kbd> <kbd>−</kbd></dd></div><div><dt>暂停星球自转</dt><dd><kbd>空格</kbd></dd></div><div><dt>回到全景</dt><dd><kbd>R</kbd></dd></div><div><dt>操作指南</dt><dd><kbd>H</kbd> / <kbd>Esc</kbd> 关闭</dd></div><div><dt>地表放置</dt><dd>选择“放置飞船”或“放置人物”，再点击星球地表；<kbd>Esc</kbd> 取消</dd></div><div><dt>摄影模式</dt><dd>相机按钮 / <kbd>P</kbd> 隐藏全部界面；<kbd>Enter</kbd> 保存 PNG；<kbd>P</kbd> / <kbd>Esc</kbd> / 双击画面退出，手机可用系统截图，双击画面退出</dd></div></dl><p class="scope-note">太阳、八颗行星和 26 颗主要卫星均可观测；“恒星系统”可切换半人马座 α，访问南门二 A/B、比邻星及比邻星行星，也可前往参宿四红超巨星。参宿四目前仅有恒星，使用 8K 表面艺术示意（紧凑设备使用原生 4K）；恒星无法着陆。巴纳德星系统包含红矮星与 d、b、c、e 四颗已确认短周期行星，轨道尺度与周期参考视向速度观测；行星半径、地表、重力和轨道倾角与方位为概念示意，大气未知。各航区设置各自的星空方向与亮度；银河使用原生 8K 全景（紧凑设备使用 4K）；半人马座恒星与系外行星地表为高清概念示意。点击顶部“自由航行”驾驶飞船：W 前进，S 减速（停稳后倒车），A/D 平移，R/F 升降，Q/E 翻滚，方向键转向，触屏按住拖动、松手回正，Shift 加速，空格刹车，C 切换视角，J 启动跃迁，L 自动着陆或起飞。接近岩石行星和卫星后可连续下降到程序化地表；着陆后按 L 或 R 起飞，空格或手动操纵中止自动下降。气态与冰巨行星没有可着陆的固体地表。辅助驾驶让速度方向平滑跟随船头。导航目标可以收起，引擎滑条独立放在下方。拖动滑条选择五档目标航速：1–100、100–1000、1000–10,000、10,000–50,000、50,000–150,000 km/s，默认 100 km/s。飞船像《无人深空》一样逐渐加减速，换档或拖动滑条不会瞬间跳速。只有离实际固体地表 10 km 以内时，滑条切换为 1–1000 m/s 的低空引擎；离开后恢复太空航速预设。两种航速分别保存，Shift 增强推力响应，空格可刹停，自动着陆和起飞辅助负责接地减速。航行距离和天体半径按真实公里比例呈现，行星位置采用静态轨道示意，支持简化惯性与实体碰撞；保存与恢复使用服务端或本机存档。</p><p class="walking-guide"><strong>离舱探索：</strong>在固体星球或卫星着陆后，按 <kbd>E</kbd> 或点击“离开飞船”。<kbd>W A S D</kbd> 行走，按住 <kbd>Shift</kbd> 奔跑，<kbd>空格</kbd> 跳跃；鼠标按住拖动或方向键看向，<kbd>C</kbd> 切换第一 / 第三人称。触屏使用移动与视角按钮，刹车按钮会变成“跳跃”，加速按钮变成“奔跑”。低重力下跳得更高、滞空更久，抓地与落地响应也会改变；高重力下跳跃更低、回落更快。仪表显示当地重力、地面 / 腾空状态、步速与距离飞船。飞船在原处等待，靠近并落地后按 <kbd>E</kbd> 或“返回飞船”返舱，再按 <kbd>L</kbd> 起飞；离舱期间无法驾驶、起飞或跃迁。<kbd>H</kbd> 打开本指南并暂停，关闭后点击“继续探索”；存档保留人物与飞船的位置。</p><details class="credits"><summary>影像与素材来源</summary><p>16K 地球日面：NASA Blue Marble；8K 云层和城市夜景：NASA MODIS / VIIRS；8K 地形：GEBCO 08。数据镜像来自 <a href="https://github.com/simon23-12/orbital-botany/tree/c92393f8be6b94f3684399f18e55790c91a8fdb4/assets/earth" target="_blank" rel="noopener noreferrer">orbital-botany</a>，NASA 影像属公共领域，GEBCO 数据可自由使用；近观微纹理为程序化细化，非新增测绘。银河背景、水星、金星云顶、火星、天王星与月球贴图：Solar System Scope（CC BY 4.0）；木星、土星、海王星、木卫一、木卫三、土卫六、土卫七与海卫一：Askaniy Anpilogov、ItzImcool、NASA/JPL-Caltech/USGS、Björn Jónsson 等，收录于 CelestiaContent（CC BY 3.0 / 4.0）；天王星卫星：ItzImcool、Paul Schenk、Ted Stryk（CC BY-SA 4.0）；其余土星卫星、木卫二与木卫四：Paul Schenk、John van Vliet 等，收录于 CelestiaContent；太阳：Ruslan Kabatsayev、NASA/SDO HMI，收录于 Stellarium（CC BY-SA 4.0）。海王星小卫星、海卫二、半人马座恒星与比邻星行星为 cubicApocalypse、MrSpace43、AstroChara、Askaniy Anpilogov 与 Solar System Scope 的高清概念图（CC BY 4.0 / CC BY-SA 4.0 / CC BY 3.0），不是实测照片。参宿四表面为原创程序化 8K / 4K 艺术示意。巴纳德星及四颗行星使用原创原生 8K / 4K 球面概念图（CC0-1.0）；行星参数见 Basant 等（2025）与 NASA 的四行星发现公告。部分影像缩小到 4K 并转换格式，未拍摄半球为示意填补。完整作者、修改、来源与许可见项目 ASSETS.md。</p></details></dialog>
  </div>
`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T =>
  document.querySelector<T>(selector)!;
const readBodyHash = (): BodyId => {
  const value =
    new URLSearchParams(window.location.hash.slice(1)).get("planet") ?? "earth";
  return isBodyId(value) ? value : "earth";
};
const state = {
  ready: false,
  mode: "observe" as "observe" | "flight",
  body: readBodyHash(),
  paused: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  view: "overview" as View,
  layers: { clouds: true, atmosphere: true, stars: true, rings: true },
  placement: null as SurfacePlacement["kind"] | null,
  photoMode: false,
};
let scene: SolarScene | undefined;
let requestVersion = 0;
let toastTimer: ReturnType<typeof setTimeout>;
let photoReturnFocus: HTMLElement | null = null;
let photoSaving = false;
const toast = (message: string) => {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2400);
};

const flight = new FlightInterface(toast, (active, target) => {
  cancelPlacement();
  state.mode = active ? "flight" : "observe";
  if (target) {
    state.body = target;
    updateBodyInfo(target);
  }
  $(".observatory").classList.toggle("flight-mode", active);
  $("#mode-flight").classList.toggle("nav-active", active);
  $("#mode-observe").classList.toggle("nav-active", !active);
  $("#mode-flight").setAttribute("aria-pressed", String(active));
  $("#mode-observe").setAttribute("aria-pressed", String(!active));
  $("#canvas-host").dataset.mode = state.mode;
  if (active) {
    $("#connection-text").textContent = "远航号 · 驾驶在线";
    $("#render-status").textContent = "多恒星系统 · 8K / 4K 银河全景";
  }
  updatePlacementControls();
});

function updatePlacementControls() {
  const solid = surfaceProfile(state.body).solid;
  for (const kind of ["ship", "person"] as const) {
    const button = $<HTMLButtonElement>(`#place-${kind}`);
    button.disabled = !state.ready || state.mode !== "observe" || !solid;
    button.setAttribute("aria-pressed", String(state.placement === kind));
  }
  $("#surface-availability").textContent = solid
    ? "选择对象，再点击星球上的位置"
    : surfaceProfile(state.body).landingReason ?? "当前天体没有可放置的固体地表";
  $("#surface-availability").hidden = state.placement !== null;
  $("#placement-hint").hidden = state.placement === null;
}

function cancelPlacement() {
  state.placement = null;
  delete $("#canvas-host").dataset.placement;
  updatePlacementControls();
}

function setPhotoMode(active: boolean) {
  if (active && (!state.ready || !scene)) return;
  if (state.photoMode === active) return;
  if (active) {
    cancelPlacement();
    photoReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach(dialog => dialog.close());
    clearTimeout(toastTimer);
    $("#toast").classList.remove("visible");
  }
  lastPhotoTap = null;
  state.photoMode = active;
  $(".observatory").classList.toggle("photo-mode", active);
  document.body.classList.toggle("photo-mode", active);
  $("#photo-mode").setAttribute("aria-pressed", String(active));
  scene?.setPhotoMode(active);
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas-host canvas");
  if (active && canvas) {
    canvas.tabIndex = 0;
    canvas.focus({ preventScroll: true });
  } else if (!active) {
    canvas?.removeAttribute("tabindex");
    photoReturnFocus?.focus({ preventScroll: true });
    photoReturnFocus = null;
  }
}

async function savePhoto() {
  if (!state.photoMode || !scene || photoSaving) return;
  photoSaving = true;
  try {
    const blob = await scene.capturePhoto();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `VOYAGER-${state.body}-${Date.now()}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    setPhotoMode(false);
    toast("照片保存失败，请重试或使用系统截图");
  } finally {
    photoSaving = false;
  }
}

function updatePause() {
  const blackHole = getBody(state.body).kind === "black-hole";
  const motion = blackHole ? "光带流动" : "自转";
  const button = $("#pause");
  button.innerHTML = icon(state.paused ? "play" : "pause");
  button.setAttribute("aria-label", `${state.paused ? "继续" : "暂停"}${motion}`);
  $(".rotation .control-label").innerHTML = blackHole ? "光带流动 <small>FLOW</small>" : "星球自转 <small>ROTATION</small>";
  $("#speed").setAttribute("aria-label", `${motion}演示速度`);
  $(".interaction-hint").innerHTML = `<span class="mouse-icon"></span> 拖动环绕 <i>·</i> 滚轮缩放 <i>·</i> <kbd>空格</kbd> 暂停${motion}`;
  button.setAttribute("aria-pressed", String(state.paused));
  scene?.setPaused(state.paused);
}

function selectView(view: View) {
  state.view = view;
  scene?.setView(view);
  document
    .querySelectorAll<HTMLButtonElement>("[data-view]")
    .forEach((button) => {
      button.classList.toggle("selected", button.dataset.view === view);
      button.setAttribute("aria-pressed", String(button.dataset.view === view));
    });
}

function setControlsReady(ready: boolean) {
  state.ready = ready;
  document
    .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(".scene-control")
    .forEach((element) => {
      element.disabled = !ready;
    });
  updatePlacementControls();
}

function updateBodyInfo(id: BodyId) {
  const body = getBody(id);
  const system = getBodySystem(body), group = getSystemGroup(id);
  const isStar = id === "sun" || body.kind === "star";
  $(".planet-info").dataset.systemGroup = group;
  $(".planet-info").dataset.body = id;
  $<HTMLSelectElement>("#star-system").value = group;
  $(".satellite-navigation").hidden = group !== "solar";
  $(".planet-rail").setAttribute("aria-label", `${system.name}天体`);
  $(".rail-label").innerHTML = group === "solar" ? "SOLAR<br>SYSTEM" : group === "betelgeuse" ? "BETEL<br>GEUSE" : group === "barnard" ? "BARNARD<br>SYSTEM" : group === "black-hole" ? "BLACK<br>HOLE" : group === "echo-rift" ? "ECHO<br>RIFT" : "ALPHA<br>CENTAURI";
  const destinations = SOLAR_SYSTEM.filter(item => getSystemGroup(item.id) === group).length;
  $(".rail-progress").innerHTML = `<b>${destinations}</b> / ${destinations}`;
  const number = SOLAR_SYSTEM.findIndex((item) => item.id === id);
  $<HTMLSelectElement>("#satellite-target").value = MOONS.some(moon => moon.id === id) ? id : "";
  const format = (value: number, decimals = 2) =>
    value.toLocaleString("zh-CN", { maximumFractionDigits: decimals });
  $(".planet-info").setAttribute("aria-label", `${body.name}信息`);
  $(".planet-info .eyebrow").innerHTML =
    `<span class="tiny-line"></span>${id === "earth" ? "我们的蓝色家园" : body.tags[1]}`;
  $("h1").innerHTML = `${id === "ceres" ? "小行星带" : body.name}<span>${body.english}</span>`;
  $(".planet-tags").innerHTML = body.tags
    .map((tag) => `<span>${tag}</span>`)
    .join("");
  $(".description").innerHTML = body.description;
  const facts = [
    [body.radiusConceptual ? "半径 · 概念值" : id === "echo-pulsar" ? "视觉半径 · 艺术放大" : ["ruin", "shard"].includes(id) ? "残骸视觉包络" : "平均半径", format(body.radiusKm, 0), "km"],
    isStar
      ? ["表面温度", format(body.temperatureK ?? 5772, 0), "K"]
      : body.parentId
        ? [`距${getBody(body.parentId).name}中心`, format(body.orbitRadiusKm!, 0), "km"]
        : body.hostStarId
          ? [`距${getBody(body.hostStarId).name}`, format(body.orbitRadiusKm! / 149597870.7, 4), "AU"]
          : ["距太阳", format(body.distanceFromSunMillionKm / 100, 3), "亿 km"],
    isStar
      ? ["光谱类型", body.spectralType ?? "G2V", ""]
      : [
          "公转周期",
          format(
            body.orbitalPeriodDays > 730
              ? body.orbitalPeriodDays / 365.25
              : body.orbitalPeriodDays,
          ),
          body.orbitalPeriodDays > 730 ? "年" : "天",
        ],
    body.systemId && body.systemId !== "solar"
      ? isStar ? ["距太阳", format(Math.hypot(...system.positionLy), 3), "光年"]
        : body.minimumMassEarth != null ? ["最低质量 · m sin i", format(body.minimumMassEarth, 3), "M⊕"] : ["地表模型", "探索示意", ""]
      : ["地轴倾角", format(body.axialTiltDeg), "°"],
  ];
  if (body.kind === "black-hole") facts.splice(0, 4, ["阴影视觉半径", format(body.radiusKm, 0), "km"], ["渲染模型", "三维盘面 / 透镜艺术近似", ""], ["地表登陆", "不可登陆", ""], ["安全屏障", "6 倍阴影半径", ""]);
  if (body.kind === "station") facts.splice(0, 4, ["设施跨度", format(body.radiusKm * 2, 0), "km"], ["轨道高度", format((body.orbitRadiusKm ?? 0) - 6371, 0), "km"], ["舰内设施", "驾驶室 / 观测舱", ""], ["停泊与探索", "L 停泊 · WASD 行走", ""]);
  $(".facts").innerHTML = facts
    .map(
      ([label, value, unit]) =>
        `<div><dt>${label}</dt><dd>${value} <small>${unit}</small></dd></div>`,
    )
    .join("");
  $(".planet-info .primary-button").innerHTML =
    `${id === "earth" ? "进入近地轨道" : `近距离观测${body.name}`} ${icon("arrow")}`;
  $(".milestone").innerHTML =
    `DESTINATION ${String(number).padStart(2, "0")} <i></i> ${id === "sun" ? "太阳系中心" : `第 ${String(number).padStart(2, "0")} 站`}`;
  $("#space-stage").setAttribute("aria-label", `${body.name}观测场景`);
  $(".top-coordinate").innerHTML =
    `<span>SECTOR ${String(number).padStart(3, "0")}</span><span>${system.name} · ${body.name}</span>`;
  $(".earth-caption").innerHTML = `<i></i><span>${body.caption}</span>`;
  $(".sun-label").hidden = isStar || body.kind === "black-hole";
  $(".sun-label span").textContent = body.hostStarId ? `${getBody(body.hostStarId).name}光方向` : "太阳光方向";
  $("#error-panel h2").textContent = `暂时无法打开${body.name}场景`;
  const nightButton = $('[data-view="night"]');
  nightButton.hidden = isStar;
  nightButton.innerHTML = `${icon("moon")} ${body.kind === "black-hole" ? "侧观" : id === "earth" ? "夜景" : "背光"}`;
  $('.segmented [data-view="close"]').innerHTML =
    `${icon("compass")} ${id === "earth" ? "近地" : "近观"}`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-layer]")
    .forEach((button) => {
      const layer = button.dataset.layer as Layer;
      button.hidden = !body.layers.includes(layer);
      button.querySelector("span")!.textContent =
        layer === "atmosphere"
          ? isStar
            ? "日冕"
            : "大气"
          : ({ clouds: "云层", stars: "星空", rings: "环系" } as const)[layer];
      button.setAttribute("aria-checked", String(state.layers[layer]));
    });
  document
    .querySelectorAll<HTMLButtonElement>("button[data-body]")
    .forEach((button) => {
      button.hidden = getSystemGroup(button.dataset.body as BodyId) !== group;
      const selected = button.dataset.body === id;
      button.classList.toggle("active", selected);
      const name = getBody(button.dataset.body as BodyId).name;
      button.setAttribute(
        "aria-label",
        `${name}，${selected ? "当前观测天体" : "切换观测"}`,
      );
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  $("#altitude").innerHTML = "— <small>km</small>";
  document.title = `远航 VOYAGER · ${body.name}观测站`;
  updatePlacementControls();
  try {
    history.replaceState(null, "", `#planet=${id}`);
  } catch {
    /* Isolated document previews may restrict history changes. */
  }
}

function showError(message: string) {
  setPhotoMode(false);
  cancelPlacement();
  flight.stop();
  ++requestVersion;
  setControlsReady(false);
  delete $("#canvas-host").dataset.ready;
  delete $("#canvas-host").dataset.body;
  $("#loading-overlay").hidden = true;
  $("#error-panel").hidden = false;
  $("#error-message").textContent = message;
  $("#connection-text").textContent = "观测站离线";
  $("#render-status").textContent = "场景加载失败";
  scene?.dispose();
  scene = undefined;
}

async function start(id: BodyId = state.body) {
  setPhotoMode(false);
  cancelPlacement();
  flight.stop();
  const version = ++requestVersion;
  state.body = id;
  state.view = "overview";
  updateBodyInfo(id);
  setControlsReady(false);
  delete $("#canvas-host").dataset.ready;
  delete $("#canvas-host").dataset.body;
  $("#error-panel").hidden = true;
  $("#loading-overlay").hidden = false;
  $("#loading-progress").style.width = "0%";
  $("#loading-text").textContent = `正在展开${getBody(id).name} · 0%`;
  $("#loading-overlay small").textContent =
    id === "earth" ? "准备高清地表与云层" : "准备天体模型与材质";
  $("#connection-text").textContent = "正在切换观测天体";
  try {
    const initialScene = !scene;
    scene ??= new SolarScene(
      $("#canvas-host"),
      ({ altitudeKm }) => {
        if (state.ready)
          $("#altitude").innerHTML =
            `${Math.round(altitudeKm).toLocaleString("zh-CN")} <small>km</small>`;
      },
      showError,
    );
    if (initialScene) {
      $<HTMLSelectElement>("#quality").value = scene.getQuality();
      $<HTMLSelectElement>("#flight-quality").value = scene.getQuality();
    }
    const shown = await scene.selectBody(id, (percent) => {
      if (version !== requestVersion) return;
      $("#loading-text").textContent =
        `正在展开${getBody(id).name} · ${percent}%`;
      $("#loading-progress").style.width = `${percent}%`;
    });
    if (!shown || version !== requestVersion) return;
    updatePause();
    for (const [layer, visible] of Object.entries(state.layers))
      scene.setLayer(layer as Layer, visible);
    scene.setSpeed(Number($<HTMLSelectElement>("#speed").value));
    scene.setQuality($<HTMLSelectElement>("#quality").value as RenderQuality);
    selectView("overview");
    setControlsReady(true);
    $("#loading-overlay").hidden = true;
    $("#connection-text").textContent = `${getBody(id).name}观测在线`;
    $("#render-status").textContent = `${surfaceMapLabel(id)} · 实时 3D 渲染`;
    $("#canvas-host").dataset.ready = "true";
    $("#canvas-host").dataset.body = id;
  } catch (error) {
    if (version !== requestVersion) return;
    console.error("Celestial scene initialization failed:", error);
    showError(
      error instanceof Error && /WebGL|context/i.test(error.message)
        ? "当前浏览器无法启用 WebGL 2。请使用支持硬件加速的现代浏览器，并开启图形加速后重试。"
        : id === "earth"
          ? "高清贴图未能完整加载。请检查连接后重新加载场景，也可先观测其他天体。"
          : "天体模型未能完成初始化，请重新加载场景。",
    );
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) =>
  button.addEventListener("click", () => {
    if (state.ready) selectView(button.dataset.view as View);
  }),
);
document
  .querySelectorAll<HTMLButtonElement>("button[data-body]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      const id = button.dataset.body as BodyId;
      if (state.mode === "flight") {
        state.body = id;
        updateBodyInfo(id);
        flight.target(id);
        return;
      }
      if (id === state.body && state.ready) selectView("overview");
      else void start(id);
    }),
  );
$("#star-system").addEventListener("change", (event) => {
  const group = (event.target as HTMLSelectElement).value;
  const id: BodyId = group === "solar" ? "earth" : STAR_SYSTEMS.find(system => system.groupId === group)!.primaryStar as BodyId;
  if (state.mode === "flight") {
    state.body = id;
    updateBodyInfo(id);
    flight.target(id);
  } else void start(id);
});
$("#satellite-target").addEventListener("change", (event) => {
  const id = (event.target as HTMLSelectElement).value;
  if (!isBodyId(id)) return;
  if (state.mode === "flight") {
    state.body = id;
    updateBodyInfo(id);
    flight.target(id);
  } else void start(id);
});
$(".brand").addEventListener("click", (event) => {
  if (publicSite) return;
  event.preventDefault();
  if (state.mode === "flight") {
    if (scene?.walking) { toast("请先返回飞船，再选择航行目的地"); return; }
    flight.target("earth");
    state.body = "earth";
    updateBodyInfo("earth");
    return;
  }
  if (state.body === "earth" && state.ready) selectView("overview");
  else void start("earth");
});
document.querySelectorAll<HTMLButtonElement>("[data-layer]").forEach((button) =>
  button.addEventListener("click", () => {
    const layer = button.dataset.layer as Layer;
    state.layers[layer] = !state.layers[layer];
    button.setAttribute("aria-checked", String(state.layers[layer]));
    scene?.setLayer(layer, state.layers[layer]);
  }),
);
$("#pause").addEventListener("click", () => {
  state.paused = !state.paused;
  updatePause();
});
$("#speed").addEventListener("change", () =>
  scene?.setSpeed(Number($<HTMLSelectElement>("#speed").value)),
);
if (window.matchMedia("(pointer: coarse)").matches || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4)
  $<HTMLSelectElement>("#quality").value = "high";
$("#quality").addEventListener("change", () => {
  const quality = $<HTMLSelectElement>("#quality").value as RenderQuality;
  scene?.setQuality(quality);
  toast(quality === "ultra" ? "已切换超清画质，近观自动加载 16K 地表细节" : quality === "high" ? "已切换高清画质" : "已切换标准画质，降低渲染负载");
});
$("#zoom-in").addEventListener("click", () => scene?.zoom(0.85));
$("#zoom-out").addEventListener("click", () => scene?.zoom(1.15));
$("#reset").addEventListener("click", () => selectView("overview"));
$("#retry").addEventListener("click", () => void start());
$("#help").addEventListener("click", () => {
  if (flight.active) flight.pause(true);
  $<HTMLDialogElement>("#help-dialog").showModal();
});
$("#help-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget)
    $<HTMLDialogElement>("#help-dialog").close();
});
$("#fullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast("当前浏览器不支持全屏模式");
  }
});
$("#mobile-settings").addEventListener("click", () => {
  const expanded =
    $("#mobile-settings").getAttribute("aria-expanded") !== "true";
  $("#mobile-settings").setAttribute("aria-expanded", String(expanded));
  $("#control-panel").classList.toggle("mobile-open", expanded);
});
$("#photo-mode").addEventListener("click", () => setPhotoMode(!state.photoMode));
for (const kind of ["ship", "person"] as const) {
  $(`#place-${kind}`).addEventListener("click", () => {
    if (!state.ready || state.mode !== "observe" || !surfaceProfile(state.body).solid) return;
    if (state.placement === kind) { cancelPlacement(); return; }
    state.placement = kind;
    $("#canvas-host").dataset.placement = kind;
    $("#placement-message").textContent = `点击星球地表，${kind === "ship" ? "停放飞船" : "开始人物探索"}`;
    $("#mobile-settings").setAttribute("aria-expanded", "false");
    $("#control-panel").classList.remove("mobile-open");
    updatePlacementControls();
  });
}
$("#cancel-placement").addEventListener("click", cancelPlacement);

async function placeOnSurface(normal: SurfacePlacement["normal"]) {
  if (!scene || !state.ready || !state.placement) return;
  const placement: SurfacePlacement = { kind: state.placement, normal };
  cancelPlacement();
  const version = ++requestVersion;
  setControlsReady(false);
  $("#loading-overlay").hidden = false;
  $("#loading-overlay small").textContent = "准备地表与探索模型";
  try {
    const ready = await flight.launch(scene, state.body, (percent) => {
      if (version !== requestVersion) return;
      $("#loading-text").textContent = `正在放置${placement.kind === "ship" ? "飞船" : "人物"} · ${percent}%`;
      $("#loading-progress").style.width = `${percent}%`;
    }, placement);
    if (!ready || version !== requestVersion) return;
    setControlsReady(true);
    $("#loading-overlay").hidden = true;
    $("#canvas-host").dataset.ready = "true";
    toast(placement.kind === "ship"
      ? "飞船已停放在所选地表 · E 离舱，L 起飞；P 进入摄影"
      : "人物已到达所选地表 · WASD 行走，空格跳跃；P 进入摄影");
  } catch (error) {
    if (version === requestVersion) showError(error instanceof Error ? error.message : "地表放置失败，请重试");
  }
}

const canvasPointers = new Map<number, { x: number; y: number; moved: boolean }>();
let lastPhotoTap: { time: number; x: number; y: number } | null = null;
$("#canvas-host").addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (canvasPointers.size) for (const pointer of canvasPointers.values()) pointer.moved = true;
  canvasPointers.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: canvasPointers.size > 0 });
});
$("#canvas-host").addEventListener("pointermove", (event) => {
  const pointer = canvasPointers.get(event.pointerId);
  if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) pointer.moved = true;
});
$("#canvas-host").addEventListener("pointerup", (event) => {
  const pointer = canvasPointers.get(event.pointerId);
  canvasPointers.delete(event.pointerId);
  if (!pointer || pointer.moved || canvasPointers.size || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) { lastPhotoTap = null; return; }
  if (state.photoMode) {
    if (event.pointerType !== "mouse") {
      const time = performance.now();
      if (lastPhotoTap && time - lastPhotoTap.time < 450 && Math.hypot(event.clientX - lastPhotoTap.x, event.clientY - lastPhotoTap.y) < 32) {
        lastPhotoTap = null;
        setPhotoMode(false);
      } else lastPhotoTap = { time, x: event.clientX, y: event.clientY };
    }
    return;
  }
  if (!state.placement || !state.ready || state.mode !== "observe") return;
  const normal = scene?.pickSurface(event.clientX, event.clientY);
  if (!normal) { toast("请点击星球表面；可先拖动或缩放寻找位置"); return; }
  void placeOnSurface(normal);
}, { capture: true });
const clearCanvasPointer = (event: PointerEvent) => {
  if (canvasPointers.delete(event.pointerId)) lastPhotoTap = null;
};
$("#canvas-host").addEventListener("pointercancel", clearCanvasPointer);
$("#canvas-host").addEventListener("lostpointercapture", clearCanvasPointer);
$("#canvas-host").addEventListener("dblclick", () => {
  if (state.photoMode) setPhotoMode(false);
});
document.addEventListener("keydown", (event) => {
  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    if (event.code === "Escape" && (state.photoMode || state.placement)) {
      event.preventDefault();
      if (state.photoMode) setPhotoMode(false);
      else cancelPlacement();
      return;
    }
    if (event.code === "KeyP" && !event.repeat && !(event.target instanceof Element && event.target.closest("input,select,textarea,dialog"))) {
      event.preventDefault();
      setPhotoMode(!state.photoMode);
      return;
    }
    if (state.photoMode && (event.code === "KeyH" || event.code === "Tab")) {
      event.preventDefault();
      return;
    }
    if (state.photoMode && event.code === "Enter") {
      event.preventDefault();
      if (!event.repeat) void savePhoto();
      return;
    }
  }
  if (state.mode === "flight") {
    if (
      event.code === "KeyH" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !(
        event.target instanceof Element &&
        event.target.closest("input,select,textarea,dialog")
      )
    ) {
      flight.pause(true);
      $<HTMLDialogElement>("#help-dialog").showModal();
    }
    return;
  }
  if (
    event.target instanceof Element &&
    event.target.closest("button, input, select, textarea, a, dialog")
  )
    return;
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    $<HTMLDialogElement>("#help-dialog").open
  )
    return;
  if (event.key.toLowerCase() === "h") {
    $<HTMLDialogElement>("#help-dialog").showModal();
    return;
  }
  if (!state.ready) return;
  if (event.code === "Space") {
    event.preventDefault();
    state.paused = !state.paused;
    updatePause();
  } else if (event.key.toLowerCase() === "r") selectView("overview");
  else if (event.key === "+" || event.key === "=") scene?.zoom(0.9);
  else if (event.key === "-") scene?.zoom(1.1);
  else if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    scene?.rotate(
      event.key === "ArrowLeft" ? -0.1 : event.key === "ArrowRight" ? 0.1 : 0,
      event.key === "ArrowUp" ? -0.1 : event.key === "ArrowDown" ? 0.1 : 0,
    );
  }
});
window.addEventListener("hashchange", () => {
  const id = readBodyHash();
  if (id !== state.body) void start(id);
});
window.addEventListener("pagehide", () => {
  flight.stop();
  scene?.dispose();
  scene = undefined;
  clearTimeout(toastTimer);
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void start();
});
$("#mode-flight").addEventListener("click", async () => {
  if (!state.ready || !scene || flight.active) return;
  cancelPlacement();
  const version = ++requestVersion;
  setControlsReady(false);
  $("#loading-overlay").hidden = false;
  $("#loading-overlay small").textContent = "准备飞船与恒星航区";
  try {
    const ready = await flight.launch(scene, state.body, (p) => {
      $("#loading-text").textContent = `正在准备航行 · ${p}%`;
      $("#loading-progress").style.width = `${p}%`;
    });
    if (!ready || version !== requestVersion) return;
    setControlsReady(true);
    $("#loading-overlay").hidden = true;
    $("#canvas-host").dataset.ready = "true";
    toast("驾驶已就绪：按 W 出发，方向键转向（触屏可拖动）");
  } catch (error) {
    if (version === requestVersion)
      showError(
        error instanceof Error ? error.message : "航区未能加载，请重试",
      );
  }
});
$("#mode-observe").addEventListener("click", () => {
  if (flight.active) void start(state.body);
});
updatePause();
watchSiteVersion();
void start().then(() => {
  if (state.ready && new URLSearchParams(location.search).get("mode") === "flight")
    $<HTMLButtonElement>("#mode-flight").click();
});
