import type { RenderQuality } from "./earth-detail";
import { FlightStore } from "./flight-store";
import { getBody, STAR_SYSTEMS } from "./solar-system";
import type { BodyId } from "./solar-system";
import type { SolarScene, FlightStats, FlightTrackingStats, SurfacePlacement } from "./planet-scene";
import type { FlightState } from "../shared/flight-state.mjs";
import { surfaceProfile } from "../shared/surface.mjs";
import { PROPULSION_BANDS, propulsionBand, speedToSlider, sliderToSpeed } from "../shared/propulsion.mjs";
import "./flight-propulsion.css";
const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
function formatFlightSpeed(value: number, maximumFractionDigits: number) {
  return Math.abs(value) >= 1e12
    ? value.toExponential(3)
    : value.toLocaleString("zh-CN", { maximumFractionDigits });
}
export class FlightInterface {
  active = false;
  private scene?: SolarScene;
  private store = new FlightStore();
  private saved: FlightState | null = null;
  private paused = false;
  private warpPhase: FlightStats["warpPhase"] = "ready";
  private landingPhase: FlightStats["landingPhase"] = "manual";
  private walking = false;
  private propulsionLowFlight = false;
  private generation = 0;
  private saving = false;
  private saveRevision = 0;
  private lastAutoElapsed = 0;
  private timer?: ReturnType<typeof setInterval>;
  private marker!: HTMLElement;
  private markerName!: HTMLElement;
  private aim!: HTMLElement;
  private deceleration!: HTMLElement;
  private trackedTarget?: BodyId;
  private trackedWalking = false;
  private navigationTitles = new Map<HTMLElement, string>();
  private notify: (message: string) => void;
  private changed: (active: boolean, target?: BodyId) => void;
  constructor(
    notify: (message: string) => void,
    changed: (active: boolean, target?: BodyId) => void,
  ) {
    this.notify = notify;
    this.changed = changed;
    document.querySelector(".main")!.insertAdjacentHTML(
      "beforeend",
      `<section id="flight-ui" class="flight-ui" aria-label="飞船驾驶台" hidden>
  <div class="flight-title"><span class="eyebrow">REAL SCALE / 星际航行</span><h2>VOYAGER <b>01</b></h2><span id="flight-system" class="flight-system">当前位置 · 太阳系</span><span id="flight-status">手动驾驶 · 引擎待命</span></div>
  <div class="flight-toolbar"><button id="starship-helm" hidden>接管星舰（E）</button><button id="flight-camera" aria-pressed="false">切换外部视角 <kbd>C</kbd></button><button id="flight-assist" aria-pressed="true">驾驶辅助：开</button><button id="flight-pause" aria-pressed="false">暂停航行</button><button id="flight-save">保存航行</button><button id="flight-resume" disabled>恢复存档</button><select id="flight-quality" aria-label="航行画质"><option value="ultra">超清</option><option value="high">高清</option><option value="standard">标准</option></select></div>
  <aside class="flight-navigation"><details id="flight-navigation" open><summary id="flight-navigation-summary" aria-label="展开或收起导航目标"><span><small id="flight-target-label">导航目标</small><b id="flight-target">地球</b></span><small id="flight-distance-summary">— km</small></summary><section class="flight-navigation-body"><p><strong id="flight-distance">—</strong><small id="flight-distance-unit"> km</small></p><small id="flight-distance-au"></small><div class="flight-navigation-actions"><button id="flight-align">对准目标</button><button id="flight-jump">跃迁 <kbd>J</kbd></button></div></section></details><button id="flight-land">自动着陆（L）</button></aside>
  <aside id="flight-propulsion" class="flight-propulsion" data-mode="space" data-band="cruise" aria-label="引擎航速"><label for="flight-engine-slider" class="flight-propulsion-reading"><strong id="flight-engine-band">巡航档</strong><span><small>目标</small> <output id="flight-target-speed">100</output><small id="flight-target-speed-unit"> km/s</small></span></label><input id="flight-engine-slider" type="range" min="0" max="500" step="0.1" value="100" aria-label="目标航速"><div id="flight-engine-bands" class="flight-engine-bands" aria-label="航速档位">${PROPULSION_BANDS.map(band => `<button type="button" data-engine-band="${band.id}" title="${band.name} · ${band.minKm.toLocaleString("zh-CN")}–${band.maxKm.toLocaleString("zh-CN")} km/s">${({ maneuver: "1–<wbr>100", cruise: "100–<wbr>1千", transfer: "1千–<wbr>1万", planetary: "1–<wbr>5万", interstellar: "5–<wbr>15万" })[band.id]}</button>`).join("")}</div><small id="flight-engine-hint">W 推进 · 空格刹车</small></aside>
  <aside class="warp-engine" id="warp-engine" data-phase="ready" aria-label="跃迁引擎"><span class="eyebrow">HYPERDRIVE / 跃迁引擎</span><strong id="warp-label">引擎就绪</strong><div class="warp-track"><i id="warp-progress"></i></div><small id="warp-hint">选择目的地，按 J 蓄能启航</small><button id="warp-cancel" hidden>中止跃迁</button></aside>
  <aside id="flight-surface" class="flight-surface" data-phase="manual" aria-label="着陆系统"><span class="eyebrow">SURFACE / 着陆系统</span><strong id="flight-surface-state">手动航行</strong><b id="flight-surface-altitude">— m</b><small id="flight-atmosphere">真空环境</small><small id="flight-landing-hint">L 自动着陆</small></aside>
  <aside id="walking-panel" class="walking-panel" data-active="false" data-grounded="true" aria-label="地表探索仪表" hidden><span class="eyebrow">EXPLORER / 地表探索</span><strong id="walking-planet">地球</strong><div class="walking-telemetry"><div><span>当地重力</span><b id="walking-gravity">— m/s²</b><small id="walking-gravity-relative">— 地球 g</small></div><div><span>移动速度</span><b id="walking-speed">0.0 m/s</b><small id="walking-grounded">在飞船内</small></div><div><span>距离飞船</span><b id="walking-distance">0.0 m</b><small>飞船停留原地</small></div></div><button id="flight-exit">离开飞船 <kbd>E</kbd></button><p id="walking-hint">着陆后可步行探索当地地形</p></aside>
  <div id="flight-deceleration" class="flight-deceleration" aria-hidden="true"><span>减速制动 / DECELERATING</span></div>
  <aside id="station-map" class="station-map" aria-label="星舰舱内导览" hidden><span class="eyebrow">TERRA / DECK 01</span><strong id="station-zone">停泊区</strong><svg viewBox="-18 -44 52 86" role="img" aria-label="停泊区经连接廊道通往驾驶室，右侧为观测舱"><path d="M-14 12H14V34H-14ZM-3 -18H3V12H-3ZM-14 -40H14V-18H-14ZM3 -14H27V10H3Z"/><text x="0" y="25">停泊区</text><text x="0" y="-27">驾驶室</text><text x="15" y="0">观测舱</text><circle id="station-map-position" cx="0" cy="24" r="1.5"/></svg><small>WASD 行走 · 跟随地面引导线</small></aside>
  <div class="flight-crosshair" aria-hidden="true"><i></i><b></b></div><div class="flight-aim" id="flight-aim" aria-hidden="true" hidden></div><div class="flight-marker" id="flight-marker" aria-hidden="true"><i></i><span>地球</span></div>
  <div class="cockpit-frame" aria-hidden="true"><i class="cockpit-left"></i><i class="cockpit-right"></i><i class="cockpit-dashboard"></i></div>
  <div class="flight-instruments"><div><span id="flight-speed-label">当前航速</span><strong id="flight-speed">0</strong><small id="flight-speed-unit">km/s</small><small id="flight-engine" data-engine="cruise">巡航档</small><small id="flight-engine-range">100–1,000 km/s</small></div><div><span>最近天体 / NEAREST</span><strong id="flight-nearest">地球</strong><small id="flight-altitude">— km 高度</small></div><div><span>航向 / HEADING</span><strong id="flight-heading">000°</strong><small id="flight-time">00:00</small></div><div class="flight-save-info"><span>航行存档 / SAVE</span><strong id="flight-storage">准备存档</strong><small>每 20 秒自动保存</small></div></div>
  <p class="flight-key-guide" id="flight-key-guide"><kbd>W S</kbd> 前进/减速 <kbd>A D</kbd> 平移 <kbd>R F</kbd> 升降 <kbd>Q E</kbd> 翻滚 <kbd>↑ ↓ ← →</kbd> 转向 <kbd>Shift</kbd> 加速 <kbd>空格</kbd> 刹车</p>
  <div class="flight-touch" aria-label="触屏驾驶控制"><div class="flight-thrust-pad"><button data-flight-input="KeyR" data-control-mode="flight" aria-label="飞船上升">升</button><button data-flight-input="KeyW" aria-label="飞船前进">前进</button><button data-flight-input="KeyF" data-control-mode="flight" aria-label="飞船下降">降</button><button data-flight-input="KeyA" aria-label="飞船左移">左移</button><button data-flight-input="Space" aria-label="飞船刹车">刹车</button><button data-flight-input="KeyD" aria-label="飞船右移">右移</button><button data-flight-input="KeyQ" data-control-mode="flight" aria-label="飞船左翻滚">↶</button><button data-flight-input="KeyS" aria-label="飞船减速或倒车">减速</button><button data-flight-input="KeyE" data-control-mode="flight" aria-label="飞船右翻滚">↷</button></div><div class="flight-steer-pad"><button data-flight-input="ArrowUp" aria-label="飞船抬头">↑</button><button data-flight-input="ArrowLeft" aria-label="飞船左转">←</button><button data-flight-input="ShiftLeft" aria-label="飞船加速">加速</button><button data-flight-input="ArrowRight" aria-label="飞船右转">→</button><button data-flight-input="ArrowDown" aria-label="飞船低头">↓</button></div></div>
 </section>`,
    );
    this.marker = $("#flight-marker");
    this.markerName = this.marker.querySelector("span")!;
    this.aim = $("#flight-aim");
    this.deceleration = $("#flight-deceleration");
    $("#flight-camera").onclick = () => this.camera();
    $("#flight-assist").onclick = () => {
      if (this.scene?.walking) { this.notify("请先返回飞船，再设置驾驶辅助"); return; }
      const state = this.scene?.flightState();
      if (!state) return;
      this.scene?.setFlightAssist(!state.assist);
      this.sync();
    };
    $("#flight-pause").onclick = () => this.pause(!this.paused);
    $("#flight-save").onclick = () => void this.save(false);
    $("#flight-resume").onclick = () => {
      if (this.saved && this.scene?.restoreFlight(this.saved)) {
        this.lastAutoElapsed = this.saved.elapsed;
        this.changed(true, this.saved.target);
        this.sync();
        this.notify("已恢复航行存档");
      }
    };
    $("#flight-align").onclick = () => {
      if (this.scene?.walking) { this.notify("请先返回飞船，再对准目标"); return; }
      this.scene?.alignFlight();
      this.notify("航向已对准目标，按 W 启动推力");
    };
    $("#flight-jump").onclick = () => this.jump();
    $("#flight-land").onclick = () => this.land();
    $("#flight-exit").onclick = () => this.explore();
    const engineSlider = $<HTMLInputElement>("#flight-engine-slider");
    const setSliderTarget = () => {
      const value = Number(engineSlider.value);
      const error = this.propulsionLowFlight
        ? this.scene?.setLowFlightSpeed(value)
        : this.scene?.setFlightCruiseSpeed(sliderToSpeed(value));
      if (error) this.notify(error);
      this.syncPropulsion();
    };
    engineSlider.oninput = setSliderTarget;
    let touchPointerId: number | null = null;
    const moveTouchSlider = (event: PointerEvent) => {
      if (engineSlider.disabled) return;
      const rect = engineSlider.getBoundingClientRect();
      const thumb = Number.parseFloat(getComputedStyle(engineSlider).getPropertyValue("--engine-thumb-size")) || 20;
      const trackWidth = rect.width - thumb;
      if (trackWidth <= 0) return;
      const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - thumb / 2) / trackWidth));
      const min = Number(engineSlider.min), max = Number(engineSlider.max), step = Number(engineSlider.step);
      const value = min + Math.round(fraction * (max - min) / step) * step;
      engineSlider.value = String(Math.max(min, Math.min(max, Number(value.toFixed(8)))));
      setSliderTarget();
    };
    engineSlider.addEventListener("pointerdown", event => {
      if (event.pointerType !== "touch" || engineSlider.disabled) return;
      event.preventDefault();
      if (touchPointerId !== null) return;
      touchPointerId = event.pointerId;
      engineSlider.setPointerCapture(event.pointerId);
      moveTouchSlider(event);
    });
    engineSlider.addEventListener("pointermove", event => {
      if (event.pointerId !== touchPointerId) return;
      event.preventDefault();
      moveTouchSlider(event);
    });
    const finishSliderPointer = (event: PointerEvent) => {
      if (event.pointerId === touchPointerId) {
        event.preventDefault();
        if (event.type === "pointerup") moveTouchSlider(event);
        touchPointerId = null;
        if (engineSlider.hasPointerCapture(event.pointerId)) engineSlider.releasePointerCapture(event.pointerId);
      }
      engineSlider.blur();
    };
    engineSlider.addEventListener("pointerup", finishSliderPointer);
    engineSlider.addEventListener("pointercancel", finishSliderPointer);
    engineSlider.addEventListener("lostpointercapture", event => {
      if (event.pointerId === touchPointerId) touchPointerId = null;
    });
    document.querySelectorAll<HTMLButtonElement>("[data-engine-band]").forEach(button => {
      button.onclick = () => {
        const band = PROPULSION_BANDS.find(candidate => candidate.id === button.dataset.engineBand)!;
        const error = this.scene?.setFlightCruiseSpeed(band.minKm);
        if (error) this.notify(error);
        this.syncPropulsion();
      };
    });
    $("#warp-cancel").onclick = () => {
      this.scene?.cancelWarp();
      this.notify("跃迁已中止，当前位置可继续手动驾驶");
    };
    if (window.matchMedia("(pointer: coarse)").matches || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4)
      $<HTMLSelectElement>("#flight-quality").value = "high";
    $("#flight-quality").onchange = () =>
      this.scene?.setQuality(
        $<HTMLSelectElement>("#flight-quality").value as RenderQuality,
      );
    document.addEventListener("keydown", (event) => {
      if (
        !this.active ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector("dialog[open]") ||
        (event.target instanceof Element &&
          event.target.closest("input,select,textarea"))
      )
        return;
      if (event.code === "KeyJ") {
        event.preventDefault();
        this.jump();
      }
      if (event.code === "KeyL") {
        event.preventDefault();
        this.land();
      }
      if (event.code === "KeyC") {
        event.preventDefault();
        this.camera();
      }
      if (event.code === "KeyX" && this.scene?.pilotingStarship) {
        event.preventDefault();
        this.explore();
      }
      if (event.code === "KeyE" && (this.scene?.walking || this.landingPhase === "landed")) {
        event.preventDefault();
        this.explore();
      }
    });
    $("#starship-helm").addEventListener("click", () => this.explore());
    document.addEventListener("visibilitychange", () => {
      if (this.active && document.hidden) this.pause(true);
    });
  }
  async launch(scene: SolarScene, id: BodyId, onProgress: (p: number) => void, placement?: SurfacePlacement) {
    const version = ++this.generation;
    this.scene = scene;
    const config = await this.store.connect();
    if (version !== this.generation) return false;
    let ready: boolean;
    try {
      ready = await scene.enterFlight(id, config, onProgress, placement);
    } catch (error) {
      if (version === this.generation) scene.leaveFlight();
      throw error;
    }
    if (!ready || version !== this.generation) return false;
    scene.setFlightHandler((stats) => this.update(stats));
    scene.setFlightTargetHandler((stats) => this.updateTracking(stats));
    this.active = true;
    this.paused = false;
    this.warpPhase = "ready";
    this.landingPhase = placement ? "landed" : "manual";
    this.lastAutoElapsed = 0;
    this.pause(false);
    scene.setQuality($<HTMLSelectElement>("#flight-quality").value as RenderQuality);
    this.saved = null;
    $("#flight-resume").setAttribute("disabled", "");
    this.changed(true, id);
    $("#flight-ui").hidden = false;
    this.sync();
    $("#flight-storage").textContent = this.store.online
      ? "服务端存档"
      : "本机存档";
    this.timer = setInterval(() => {
      const elapsed = this.scene?.flightState()?.elapsed ?? 0;
      if (this.active && !this.paused && this.warpPhase === "ready" && elapsed - this.lastAutoElapsed >= 20)
        void this.save(true);
    }, 1000);
    const revision = this.saveRevision;
    void this.store.read().then((saved) => {
      if (this.generation !== version || revision !== this.saveRevision) return;
      this.saved = saved;
      $<HTMLButtonElement>("#flight-resume").disabled = !saved;
    });
    return true;
  }
  stop() {
    const wasActive = this.active;
    const target = this.scene?.flightState()?.target;
    if (this.active) {
      const state = this.scene?.flightState();
      if (state) void this.store.save(state).catch(() => {});
    }
    ++this.generation;
    clearInterval(this.timer);
    this.scene?.leaveFlight();
    this.active = false;
    this.walking = false;
    this.paused = false;
    this.landingPhase = "manual";
    this.warpPhase = "ready";
    this.trackedWalking = false;
    this.trackedTarget = undefined;
    this.markerName.textContent = target ? getBody(target).name : "导航目标";
    $("#flight-ui").dataset.mode = "flight";
    $("#flight-ui").dataset.exploration = "ship";
    delete $("#flight-ui").dataset.landed;
    $("#walking-panel").hidden = true;
    $("#station-map").hidden = true;
    $("#walking-panel").dataset.active = "false";
    if (wasActive) {
      document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("[data-body], #satellite-target, #star-system").forEach((button) => {
        button.disabled = false;
        const title = this.navigationTitles.get(button);
        if (title !== undefined) button.title = title;
      });
    }
    this.navigationTitles.clear();
    $("#flight-ui").hidden = true;
    this.changed(false);
  }
  target(id: BodyId) {
    if (this.scene?.walking) { this.notify("请先返回飞船，再设置导航目标"); return; }
    if (["charging", "transit", "arrival"].includes(this.warpPhase)) return;
    this.scene?.setDestination(id);
    this.sync();
  }
  private jump() {
    if (this.scene?.walking) { this.notify("人物正在舱外探索，请先返回飞船再启动跃迁"); return; }
    const error = this.scene?.jumpFlight();
    if (error) { this.notify(error); return; }
    this.pause(false);
    this.notify("跃迁引擎开始蓄能，可随时暂停或中止");
  }
  private land() {
    if (this.scene?.walking) { this.explore(); return; }
    const previous = this.landingPhase;
    const error = this.scene?.landFlight();
    if (error) { this.notify(error); return; }
    this.pause(false);
    if (this.scene?.inStation) {
      this.sync();
      this.notify("已登上星舰 · 沿引导线前往驾驶室，绕过全息桌，到前窗驾驶台按 E 接管");
      return;
    }
    this.notify(previous === "landed" ? "起飞辅助启动，正在离开地表" : previous === "manual"
      ? "自动着陆启动，刹车或手动操纵可中止" : "已中止自动航行，恢复手动驾驶");
  }
  private explore() {
    if (!this.active || !this.scene) return;
    if (this.paused) { this.notify("请先继续航行或探索，再离舱或返回飞船"); return; }
    const returning = this.scene.walking;
    const stationReturn = this.scene.aboardStarship;
    const error = this.scene.walkFlight();
    if (error) { this.notify(error); return; }
    this.sync();
    this.notify(stationReturn ? this.scene.pilotingStarship ? "已接管星舰 · W/S 推力，方向键转向，R/F 升降，Q/E 翻滚，C 外部视角，X 离开驾驶座" : "已离开驾驶座 · 可在舰内自由走动，星舰继续由驾驶辅助控制" : returning ? "已返回飞船，按 L 起飞" : "已离开飞船 · WASD 行走，空格跳跃，Shift 奔跑；靠近飞船按 E 返回");
  }
  private sync() {
    const state = this.scene?.flightState();
    if (!state) return;
    this.walking = this.scene?.walking ?? false;
    $(".flight-title h2").innerHTML = this.scene?.aboardStarship ? "TERRA <b>STARSHIP</b>" : "VOYAGER <b>01</b>";
    const thirdPerson = this.scene?.walkingCamera === "third";
    $("#flight-ui").dataset.mode = this.walking ? "walking" : "flight";
    $("#flight-ui").dataset.exploration = this.scene?.inStation ? "station" : this.walking ? "walking" : "ship";
    $("#flight-ui").setAttribute("aria-label", this.scene?.inStation ? "星舰探索控制台" : this.walking ? "地表探索控制台" : "飞船驾驶台");
    $("#flight-camera").innerHTML = this.walking
      ? `${thirdPerson ? "切换第一人称" : "切换第三人称"} <kbd>C</kbd>`
      : `${state.camera === "cockpit" ? "切换外部视角" : "切换座舱视角"} <kbd>C</kbd>`;
    $("#flight-camera").setAttribute(
      "aria-pressed",
      String(this.walking ? thirdPerson : state.camera === "chase"),
    );
    $(".cockpit-frame").hidden = this.scene?.aboardStarship || this.walking || state.camera === "chase";
    $("#flight-assist").textContent = this.walking ? "驾驶辅助：需返舱" : `驾驶辅助：${state.assist ? "开" : "关"}`;
    $("#flight-assist").setAttribute("aria-pressed", String(state.assist));
    $<HTMLButtonElement>("#flight-assist").disabled = this.walking;
    $("#flight-assist").title = this.walking ? "人物离舱后，飞船停留原地；返舱后可设置驾驶辅助" : "辅助速度方向跟随船头";
    $("#flight-target-label").textContent = this.walking ? this.scene?.inStation ? "前往驾驶台" : "返回飞船" : getBody(state.target).kind === "black-hole" ? "导航目标 · 距阴影边缘" : "导航目标";
    $("#flight-target").textContent = this.walking ? this.scene?.inStation ? "TERRA / HELM" : "VOYAGER 01" : getBody(state.target).name;
    $("#flight-speed-label").textContent = this.walking ? "移动速度" : "当前航速";
    $("#flight-key-guide").innerHTML = this.walking
      ? "<kbd>W S A D</kbd> 行走 <kbd>鼠标拖动 / 方向键</kbd> 看向 <kbd>Shift</kbd> 奔跑 <kbd>空格</kbd> 跳跃 <kbd>E</kbd> 接管 / 返舱 <kbd>C</kbd> 第一/第三人称 <kbd>H</kbd> 帮助"
      : "<kbd>W S</kbd> 前进/减速 <kbd>A D</kbd> 平移 <kbd>R F</kbd> 升降 <kbd>Q E</kbd> 翻滚 <kbd>↑ ↓ ← →</kbd> 转向 <kbd>Shift</kbd> 加速 <kbd>空格</kbd> 刹车 <kbd>X</kbd> 离开星舰驾驶座 / <kbd>E</kbd> 着陆后离舱";
    const touchLabels: Record<string, [string, string, string]> = {
      KeyW: ["前进", "向前行走", "飞船前进"], KeyS: [this.walking ? "后退" : "减速", "向后行走", "飞船减速或倒车"],
      KeyA: ["左移", "向左行走", "飞船左移"], KeyD: ["右移", "向右行走", "飞船右移"],
      Space: [this.walking ? "跳跃" : "刹车", "人物跳跃", "飞船刹车"], ShiftLeft: [this.walking ? "奔跑" : "加速", "按住奔跑", "飞船加速"],
      ArrowUp: ["↑", "向上看", "飞船抬头"], ArrowDown: ["↓", "向下看", "飞船低头"],
      ArrowLeft: ["←", "向左看", "飞船左转"], ArrowRight: ["→", "向右看", "飞船右转"],
    };
    for (const [key, [label, walkingLabel, flightLabel]] of Object.entries(touchLabels)) {
      const button = $<HTMLButtonElement>(`[data-flight-input="${key}"]`);
      button.textContent = label;
      button.setAttribute("aria-label", this.walking ? walkingLabel : flightLabel);
    }
    $(".flight-touch").setAttribute("aria-label", this.walking ? "触屏行走、跳跃与视角控制" : "触屏驾驶控制");
    this.syncPropulsion();
  }
  private syncPropulsion() {
    const state = this.scene?.flightState();
    if (state) this.updatePropulsion(state.cruiseSpeedKm ?? 100, state.lowFlightSpeedMps ?? 1000, this.propulsionLowFlight);
  }
  private updatePropulsion(cruiseSpeedKm: number, lowFlightSpeedMps: number, lowFlight: boolean) {
    this.propulsionLowFlight = lowFlight;
    const band = propulsionBand(cruiseSpeedKm);
    const slider = $<HTMLInputElement>("#flight-engine-slider");
    slider.min = lowFlight ? "1" : "0";
    slider.max = lowFlight ? "1000" : "500";
    slider.step = lowFlight ? "1" : "0.1";
    slider.value = String(lowFlight ? lowFlightSpeedMps : speedToSlider(cruiseSpeedKm));
    slider.disabled = this.walking;
    const target = lowFlight ? lowFlightSpeedMps : cruiseSpeedKm;
    const unit = lowFlight ? "m/s" : "km/s";
    const name = lowFlight ? "低空引擎" : band.name;
    $("#flight-propulsion").dataset.mode = lowFlight ? "ground" : "space";
    $("#flight-propulsion").dataset.band = lowFlight ? "low" : band.id;
    $("#flight-engine-band").textContent = name;
    $("#flight-target-speed").textContent = formatFlightSpeed(target, lowFlight ? 0 : 1);
    $("#flight-target-speed-unit").textContent = ` ${unit}`;
    slider.setAttribute("aria-valuetext", `${formatFlightSpeed(target, lowFlight ? 0 : 1)} ${unit} · ${name}`);
    $("#flight-engine-bands").hidden = lowFlight;
    document.querySelectorAll<HTMLButtonElement>("[data-engine-band]").forEach(button => {
      button.disabled = lowFlight || this.walking;
      button.setAttribute("aria-pressed", String(!lowFlight && button.dataset.engineBand === band.id));
    });
    $("#flight-engine-hint").textContent = this.walking ? "返舱后可调节航速"
      : this.landingPhase !== "manual" || ["charging", "transit", "arrival"].includes(this.warpPhase) ? "辅助飞行 · 航速设定已保留"
      : "W 推进 · 空格刹车";
  }
  private camera() {
    if (this.scene?.walking) {
      this.scene.setWalkingCamera(this.scene.walkingCamera === "first" ? "third" : "first");
      this.sync();
      return;
    }
    const state = this.scene?.flightState();
    if (!state) return;
    this.scene?.setFlightCamera(
      state.camera === "cockpit" ? "chase" : "cockpit",
    );
    this.sync();
  }
  pause(paused: boolean) {
    if (!this.active) return;
    this.paused = paused;
    this.scene?.setFlightPaused(paused);
    $("#flight-pause").textContent = this.scene?.walking ? paused ? "继续探索" : "暂停探索" : paused ? "继续航行" : "暂停航行";
    $("#flight-pause").setAttribute("aria-pressed", String(paused));
  }
  private async save(automatic: boolean) {
    const state = this.scene?.flightState();
    if (!state || !this.active || this.saving) return;
    this.saving = true;
    ++this.saveRevision;
    const generation = this.generation;
    $<HTMLButtonElement>("#flight-save").disabled = true;
    $("#flight-storage").textContent = "正在保存…";
    try {
      const source = await this.store.save(state);
      if (generation !== this.generation) return;
      this.saved = state;
      this.lastAutoElapsed = state.elapsed;
      $<HTMLButtonElement>("#flight-resume").disabled = false;
      $("#flight-storage").textContent =
        source === "server" ? "已保存 · 服务端" : "已保存 · 本机";
      if (!automatic) this.notify("航行状态已保存");
    } catch (error) {
      if (generation === this.generation) {
        $("#flight-storage").textContent = "保存失败";
        this.notify(
          error instanceof Error ? error.message : "航行存档未能保存，请重试",
        );
      }
    } finally {
      this.saving = false;
      $<HTMLButtonElement>("#flight-save").disabled = false;
    }
  }
  private update(stats: FlightStats) {
    if (!this.active) return;
    const helm = $<HTMLButtonElement>("#starship-helm");
    helm.hidden = !this.scene?.aboardStarship;
    helm.textContent = this.scene?.pilotingStarship ? "离开驾驶座（X）" : "接管星舰（E）";
    helm.disabled = this.paused || (!this.scene?.pilotingStarship && !this.scene?.helmAvailable) || stats.warpPhase !== "ready";
    if (this.walking !== !!this.scene?.walking) this.sync();
    const number = (n: number) => Math.round(n).toLocaleString("zh-CN");
    const lightspeed = stats.warpPhase === "transit" && stats.speedKm > 299792.458;
    const metres = !lightspeed && (stats.environment.lowFlight || stats.landingPhase !== "manual");
    $("#flight-speed").textContent = lightspeed
      ? formatFlightSpeed(stats.speedKm / 299792.458, 1)
      : formatFlightSpeed(stats.speedKm * (metres ? 1000 : 1), 1);
    $("#flight-speed-unit").textContent = lightspeed ? "× 光速" : metres ? "m/s" : "km/s";
    const lightYearKm = 9460730472580.8;
    const useLy = stats.distanceKm >= lightYearKm * 0.05;
    const useAu = !useLy && stats.distanceKm > 1_000_000;
    $("#flight-distance").textContent = useLy ? (stats.distanceKm / lightYearKm).toFixed(3) : useAu ? (stats.distanceKm / 149597870.7).toFixed(3) : number(stats.distanceKm);
    $("#flight-distance-unit").textContent = useLy ? " 光年" : useAu ? " AU" : " km";
    $("#flight-distance-summary").textContent = `${$("#flight-distance").textContent}${$("#flight-distance-unit").textContent}`;
    $("#flight-distance-au").textContent = useLy ? `${(stats.distanceKm / 149597870.7).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} AU` : useAu ? `${number(stats.distanceKm)} km` : `${(stats.distanceKm / 149597870.7).toFixed(6)} AU`;
    $("#flight-system").textContent = `当前位置 · ${STAR_SYSTEMS.find(system => system.id === stats.systemId)!.name}`;
    const labels = { ready: "引擎就绪", charging: "引擎蓄能", transit: "跃迁航行", arrival: "减速抵达", cooldown: "引擎冷却" };
    const activeWarp = ["charging", "transit", "arrival"].includes(stats.warpPhase);
    if (stats.landingPhase === "landed" && this.landingPhase !== "landed") this.notify(`已在${getBody(stats.nearest).name}地表着陆，按 E 离舱探索，或 L / R 起飞`);
    this.landingPhase = stats.landingPhase;
    const flightLand = $<HTMLButtonElement>("#flight-land");
    flightLand.textContent = stats.landingPhase === "landed" ? "起飞（L）" : stats.landingPhase === "descending"
      ? "中止着陆（L）" : stats.landingPhase === "ascending" ? "中止起飞（L）" : "自动着陆（L）";
    if (stats.target === "earth-station" && stats.landingPhase === "manual") flightLand.textContent = "停泊并进入星舰（L）";
    flightLand.disabled = activeWarp || (stats.landingPhase === "manual" && !!stats.landingBlockReason);
    flightLand.title = stats.landingBlockReason ?? "连续下降并降落到地表";
    $("#flight-surface").dataset.phase = stats.landingPhase;
    $("#flight-surface-state").textContent = { manual: "手动航行", descending: "自动下降 · 起落架展开", landed: "已着陆 · 引擎待命", ascending: "起飞辅助 · 正在爬升" }[stats.landingPhase];
    $("#flight-surface-altitude").textContent = stats.environment.profile.solid
      ? `离地 ${(stats.environment.groundAltitudeKm * 1000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} m`
      : "无固体地表";
    $("#flight-atmosphere").textContent = stats.environment.atmospheric
      ? `大气密度 ${stats.environment.density.toFixed(3)} · ${stats.environment.density > 0.02 ? "气动阻力生效" : "稀薄大气"}`
      : "真空环境 · 无大气阻力";
    $("#flight-landing-hint").textContent = stats.landingPhase === "landed" ? "E 离舱探索 · L / R 起飞 · 可保存地表位置"
      : stats.landingPhase === "descending" || stats.landingPhase === "ascending" ? "空格或手动操纵中止 · 暂停冻结进度"
      : stats.landingBlockReason ?? "L 自动着陆 · 辅助下降与制动";
    if (stats.target === "earth-station" && stats.landingPhase === "manual") {
      $("#flight-surface-state").textContent = "星舰停泊系统";
      $("#flight-surface-altitude").textContent = `距星舰 ${number(stats.distanceKm)} km`;
      $("#flight-landing-hint").textContent = stats.landingBlockReason ?? "L 停泊并离舱 · 驾驶室 / 观测舱开放";
    }
    const band = propulsionBand(stats.cruiseSpeedKm);
    $("#flight-engine").textContent = activeWarp ? "跃迁引擎" : stats.environment.lowFlight ? "低空引擎" : band.name;
    $("#flight-ui").dataset.environment = stats.environment.atmospheric ? "atmosphere" : stats.environment.lowFlight ? "near" : "space";
    $("#flight-ui").dataset.warpActive = String(activeWarp);
    $("#flight-engine").dataset.engine = activeWarp ? "warp" : stats.environment.lowFlight ? "low" : band.id;
    $("#flight-engine-range").textContent = activeWarp ? "跃迁中"
      : stats.landingPhase !== "manual" ? "着陆与起飞辅助"
      : stats.environment.lowFlight ? "1–1,000 m/s"
      : `${number(band.minKm)}–${number(band.maxKm)} km/s`;
    this.updatePropulsion(stats.cruiseSpeedKm, stats.lowFlightSpeedMps, stats.environment.lowFlight);
    if (this.warpPhase === "arrival" && stats.warpPhase === "cooldown") this.notify("跃迁完成，已减速抵达目标附近");
    this.warpPhase = stats.warpPhase;
    $("#warp-engine").dataset.phase = stats.warpPhase;
    $("#warp-label").textContent = stats.warpPhase === "ready" && stats.warpBlockReason ? "跃迁受限" : labels[stats.warpPhase];
    $("#warp-progress").style.width = `${stats.warpProgress * 100}%`;
    $("#warp-hint").textContent = stats.warpPhase === "ready" ? stats.warpBlockReason ?? "选择目的地，按 J 蓄能启航" : stats.warpPhase === "cooldown" ? "可自由驾驶，冷却后可再次跃迁" : `${Math.round(stats.warpProgress * 100)}% · ${getBody(stats.target).name}`;
    $("#warp-cancel").hidden = !activeWarp;
    $<HTMLButtonElement>("#flight-jump").disabled = !!stats.warpBlockReason;
    $("#flight-jump").title = stats.warpBlockReason ?? "启动跃迁（J）";
    $<HTMLButtonElement>("#flight-align").disabled = activeWarp || stats.landingPhase !== "manual";
    $<HTMLButtonElement>("#flight-resume").disabled = activeWarp || !this.saved;
    document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("[data-body], #satellite-target, #star-system").forEach((button) => { button.disabled = activeWarp; });
    $("#flight-nearest").textContent = getBody(stats.nearest).name;
    $("#flight-altitude").textContent = `${number(stats.altitudeKm)} km ${getBody(stats.nearest).kind === "black-hole" ? "距阴影边缘" : "高度"}`;
    $("#flight-heading").textContent =
      `${Math.round(stats.heading).toString().padStart(3, "0")}°`;
    const seconds = Math.floor(stats.elapsed);
    $("#flight-time").textContent = `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
    $("#flight-status").textContent = this.paused
      ? "航行已暂停"
      : stats.landingPhase !== "manual" ? { descending: "自动着陆 · 下降与减速", landed: "已在地表着陆 · 按 L 起飞", ascending: "起飞辅助 · 离开地表" }[stats.landingPhase]
      : activeWarp
        ? labels[stats.warpPhase]
      : stats.collision
        ? getBody(stats.collision).kind === "black-hole" ? "黑洞安全屏障已制动 · 请转向离开" : "碰撞已制动 · 请转向离开"
        : stats.boosting
          ? "加速航行 · 推力增强"
          : stats.speedKm < 1
            ? "手动驾驶 · 引擎待命"
            : "手动驾驶 · 自由航行";
    this.updateWalking(stats);
  }
  private updateWalking(stats: FlightStats) {
    const walking = stats.walking;
    const active = !!this.scene?.walking;
    const station = stats.station;
    const landed = stats.landingPhase === "landed";
    $("#flight-ui").dataset.landed = String(landed);
    const panel = $("#walking-panel");
    panel.hidden = !active && !landed;
    panel.dataset.active = String(active);
    panel.dataset.grounded = String(walking?.grounded ?? true);
    $("#flight-surface").hidden = active || landed;
    const gravity = walking?.gravity ?? stats.environment.profile.gravity;
    const estimatedGravity = !station && surfaceProfile(walking?.bodyId ?? stats.nearest).gravityEstimated;
    const relativeGravity = gravity / 9.80665;
    const relativeGravityLabel = relativeGravity > 0 && relativeGravity < 0.01
      ? relativeGravity.toLocaleString("zh-CN", { maximumSignificantDigits: 3 }) : relativeGravity.toFixed(2);
    $("#walking-planet").textContent = station ? `TERRA · ${station.zone}` : `${getBody(walking?.bodyId ?? stats.nearest).name} · ${active ? "舱外探索" : "已着陆"}`;
    panel.setAttribute("aria-label", station ? "星舰探索仪表" : "地表探索仪表");
    panel.querySelector(".eyebrow")!.textContent = station ? "STATION / 星舰探索" : "EXPLORER / 地表探索";
    $("#walking-gravity").textContent = `${gravity.toLocaleString("zh-CN", { maximumFractionDigits: 3 })} m/s²`;
    $("#walking-gravity-relative").textContent = station ? "站内人工重力" : `${relativeGravityLabel} 地球 g${estimatedGravity ? " · 估算" : ""}`;
    $("#walking-speed").textContent = `${(walking?.speedMps ?? 0).toFixed(1)} m/s`;
    $(".walking-telemetry > div:last-child span").textContent = station ? "距离驾驶台" : "距离飞船";
    $(".walking-telemetry > div:last-child small").textContent = station ? "星舰由驾驶辅助控制" : "飞船停留原地";
    $("#walking-distance").textContent = `${(walking?.distanceToShipM ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} m`;
    $("#walking-grounded").textContent = active ? walking?.grounded ? "在地面" : "腾空中" : "在飞船内 · 已停稳";
    $("#flight-exit").hidden = active;
    $<HTMLButtonElement>("#flight-exit").disabled = this.paused;
    const gravityHint = gravity < 0.35 ? " 极低重力：宇航服回落辅助已启用。" : estimatedGravity ? " 当地重力采用估算值。" : "";
    $("#walking-hint").textContent = (active
      ? "空格跳跃 · Shift 奔跑 · 鼠标拖动 / 方向键看向；靠近飞船并落地后，按 E 返回。飞船停留原地。"
      : "按 E 离舱，探索当地地形。不同重力会改变跳跃高度、滞空时间和行走抓地感。") + gravityHint;
    if (station) $("#walking-hint").textContent = "沿引导线走到驾驶室，绕过全息桌，到前窗驾驶台 3 米内按 E 接管星舰。驾驶时按 X 返回舰内步行。";
    $("#station-map").hidden = !station;
    if (station) {
      $("#station-zone").textContent = station.zone;
      const visit = this.scene?.flightState()?.stationVisit;
      const dot = document.querySelector("#station-map-position")!;
      dot.setAttribute("cx", String(visit?.positionM[0] ?? 0));
      dot.setAttribute("cy", String(visit?.positionM[2] ?? 24));
    }
    $("#warp-engine").hidden = active || landed;
    $<HTMLInputElement>("#flight-engine-slider").disabled = active;
    document.querySelectorAll<HTMLButtonElement>("[data-engine-band]").forEach(button => { button.disabled = active || this.propulsionLowFlight; });
    document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("[data-body], #satellite-target, #star-system").forEach((button) => {
      button.disabled = active || ["charging", "transit", "arrival"].includes(stats.warpPhase);
      if (active) {
        if (!this.navigationTitles.has(button)) this.navigationTitles.set(button, button.title);
        button.title = "请先返回飞船，再选择航行目的地";
      } else if (this.navigationTitles.has(button)) {
        button.title = this.navigationTitles.get(button)!;
        this.navigationTitles.delete(button);
      }
    });
    if (!active) return;
    $("#flight-system").textContent = station ? `TERRA 星舰 · ${station.zone}` : `当前位置 · ${getBody(walking?.bodyId ?? stats.nearest).name}地表`;
    $("#flight-pause").textContent = this.paused ? "继续探索" : "暂停探索";
    $("#flight-status").textContent = station ? this.paused ? "星舰探索已暂停" : `${station.zone} · 驾驶台附近 E 接管星舰` : this.paused ? "地表探索已暂停" : walking?.grounded ? "地表探索 · E 靠近返舱" : "地表探索 · 腾空中";
    $("#flight-distance-summary").textContent = `${(walking?.distanceToShipM ?? 0).toFixed(1)} m`;
    $("#flight-speed").textContent = (walking?.speedMps ?? 0).toFixed(1);
    $("#flight-speed-unit").textContent = "m/s";
    $("#flight-engine").textContent = station ? "舰内行走 · 驾驶辅助接管" : "人物行走 · 飞船原地待命";
    $("#flight-engine-range").textContent = "空格跳跃 · Shift 奔跑";
    $("#flight-altitude").textContent = station ? `${station.zone} · 人工重力已启用` : walking?.grounded ? "在地面 · 跟随当地重力" : "腾空中 · 重力持续生效";
    const flightLand = $<HTMLButtonElement>("#flight-land");
    flightLand.textContent = station ? "接管星舰（E）" : "返回飞船（E）";
    flightLand.disabled = this.paused || (station ? !this.scene?.helmAvailable : !walking?.grounded || walking.distanceToShipM > 12);
    flightLand.title = station ? "落地并靠近驾驶室前窗驾驶台 3 米内，按 E 接管星舰" : this.paused ? "请先继续探索" : !walking?.grounded ? "请先落地，再返回飞船"
      : walking.distanceToShipM > 12 ? "请靠近停泊飞船至 12 米内，再进入飞船" : "返回飞船；返舱后可起飞";
    for (const id of ["flight-align", "flight-jump"]) {
      const button = $<HTMLButtonElement>(`#${id}`);
      button.disabled = true;
      button.title = "人物正在舱外探索，请先返回飞船";
    }
  }
  private updateTracking(stats: FlightTrackingStats) {
    if (!this.active) return;
    this.marker.style.transform = `translate3d(${stats.targetX * stats.width / 100}px, ${stats.targetY * stats.height / 100}px, 0) translate(-50%, -50%)`;
    this.marker.style.setProperty("--target-angle", `${stats.angle}deg`);
    this.marker.classList.toggle("offscreen", !stats.inView);
    if (stats.target !== this.trackedTarget || this.walking !== this.trackedWalking) {
      this.markerName.textContent = this.walking ? "停泊飞船" : getBody(stats.target).name;
      this.trackedTarget = stats.target;
      this.trackedWalking = this.walking;
    }
    this.deceleration.style.opacity = this.walking ? "0" : stats.deceleration.toFixed(3);
    this.deceleration.style.setProperty("--brake-scale", String(0.72 + stats.deceleration * 0.28));
    this.aim.hidden = this.walking || !stats.steering;
    this.aim.style.transform = `translate3d(${(0.5 + stats.aimX * 0.35) * stats.width}px, ${(0.5 + stats.aimY * 0.35) * stats.height}px, 0) translate(-50%, -50%)`;
  }
}
