import "./site.css";
import { SOLAR_SYSTEM, getBody, getBodySystem, isBodyId } from "./solar-system";
import { watchSiteVersion } from "./site-version";

const base = import.meta.env.BASE_URL;
const game =
  import.meta.env.VITE_PUBLIC_SITE === "true"
    ? `${base}game.html`
    : `${base}index.html`;
const revision = import.meta.env.VITE_SITE_REVISION ?? "development";
const repo = "https://github.com/dns0129/space_exploration";
const arrow =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
const orbit =
  '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="20" cy="20" r="9"/><ellipse cx="20" cy="20" rx="19" ry="7" transform="rotate(-35 20 20)"/><circle cx="33" cy="11" r="2" fill="currentColor" stroke="none"/></svg>';
const downloadLink = import.meta.env.VITE_PUBLIC_SITE === "true"
  ? `${base}downloads/voyager-warp.zip`
  : "https://dns0129.github.io/space_exploration/downloads/voyager-warp.zip";
const flightLink = `${game}?mode=flight&build=${revision}#planet=earth`;
const observationLink = (body: string) =>
  `${game}?build=${revision}#planet=${body}`;

document.querySelector<HTMLDivElement>("#site")!.innerHTML = `
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <header class="site-header wrap">
    <a class="site-brand" href="#" aria-label="星际探索首页">${orbit}<span>星际探索<small>VOYAGER / SPACE EXPLORATION</small></span></a>
    <nav class="site-nav" id="site-navigation" aria-label="网站导航"><a href="#destinations">探索目的地</a><a href="#experience">航行体验</a><a href="#guide">驾驶指南</a></nav>
    <div class="header-actions"><a class="header-launch" href="${flightLink}">进入驾驶舱 ${arrow}</a><button class="menu-toggle" aria-label="打开导航" aria-expanded="false" aria-controls="site-navigation"><span></span><span></span></button></div>
  </header>
  <main id="main-content">
    <section class="hero wrap" aria-labelledby="hero-title">
      <div class="hero-orbits" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="hero-planet"><img src="${base}site/earth.png" width="900" height="900" alt="在阳光下呈现海洋、大陆与云层的三维地球" fetchpriority="high" /><span class="planet-coordinate">SOL III · EARTH<br>23° 26′ / BLUE PLANET</span></div>
      <div class="hero-copy"><p class="section-kicker"><i></i>你的下一站，是宇宙 <span>MISSION 001</span></p><h1 id="hero-title">离开地球，<br>去看更远的<span>宇宙。</span></h1><p class="hero-intro">从熟悉的蓝色星球启航。<br>穿过星光，掠过土星环，让好奇心决定航向。</p><div class="hero-actions"><a class="button button-primary" href="${flightLink}">立即启航 ${arrow}</a><a class="text-link" href="#destinations">先探索太阳系 <span>↘</span></a></div><p class="launch-note"><span></span>浏览器直接体验 <i>·</i> 无需安装 <i>·</i> 支持键盘与触屏</p></div>
      <div class="hero-bottom"><div class="hero-stats"><div><strong>${SOLAR_SYSTEM.length}<small>个</small></strong><span>太阳系 · 半人马座 α · 巴纳德星 · 参宿四 · 回声裂隙 · 黑洞</span></div><div><strong>8K</strong><span>真实银河全景背景</span></div><div><strong>1:1</strong><span>真实航区公里尺度 · 虚构航区原创设定</span></div></div><a class="scroll-cue" href="#destinations"><span>向未知出发<br><small>SCROLL TO EXPLORE</small></span><b>↓</b></a></div>
    </section>
    <section class="destinations wrap section" id="destinations" aria-labelledby="destinations-title">
      <div class="section-heading"><div><p class="section-kicker">01 / DESTINATIONS</p><h2 id="destinations-title">跨越恒星，探索 ${SOLAR_SYSTEM.length} 个目的地。</h2></div><p>从太阳系，到半人马座 α、巴纳德星、参宿四、回声裂隙与黑洞星系。<br>每一次靠近，都有新的风景。</p></div>
      <div class="destination-tabs" role="group" aria-label="选择探索天体">${SOLAR_SYSTEM.map((body) => `<button data-destination="${body.id}" aria-pressed="${body.id === "earth"}" class="${body.id === "earth" ? "selected" : ""}">${body.name}</button>`).join("")}</div>
      <article class="destination-detail" aria-live="polite"><div class="destination-number" id="destination-number">03</div><div class="destination-description"><p class="section-kicker" id="destination-english">EARTH / SOL III</p><h3 id="destination-name">地球</h3><p id="destination-description">我们的蓝色家园，也是星际旅程的起点。</p></div><dl class="destination-facts"><div><dt id="destination-radius-label">平均半径</dt><dd id="destination-radius">6,371 <small>km</small></dd></div><div><dt id="destination-distance-label">距太阳平均距离</dt><dd id="destination-distance">1.000 <small>AU</small></dd></div></dl><a class="round-link" id="destination-link" href="${observationLink("earth")}" aria-label="观测地球">${arrow}</a></article>
      <div class="world-cards"><a class="world-card earth-card" href="${observationLink("earth")}"><div class="card-top"><span>01 / OUR HOME</span>${arrow}</div><img src="${base}site/earth.png" alt="地球三维模型" width="900" height="900" loading="lazy" /><div class="card-bottom"><div><small>THE BLUE PLANET</small><h3>地球 <span>Earth</span></h3></div><span class="card-label">从这里出发</span></div></a><a class="world-card mars-card" href="${observationLink("mars")}"><div class="card-top"><span>02 / RED FRONTIER</span>${arrow}</div><img src="${base}site/mars.png" alt="火星的红色地表" width="900" height="900" loading="lazy" /><div class="card-bottom"><div><small>THE RED PLANET</small><h3>火星 <span>Mars</span></h3></div><span class="card-label">岩石世界</span></div></a><a class="world-card saturn-card" href="${observationLink("saturn")}"><div class="card-top"><span>03 / BEYOND THE RINGS</span>${arrow}</div><img src="${base}site/saturn.png" alt="土星与倾斜的环系" width="900" height="900" loading="lazy" /><div class="card-bottom"><div><small>THE RINGED GIANT</small><h3>土星 <span>Saturn</span></h3></div><span class="card-label">环系奇观</span></div></a></div>
    </section>
    <section class="experience wrap section" id="experience" aria-labelledby="experience-title"><div class="section-heading"><div><p class="section-kicker">02 / THE EXPERIENCE</p><h2 id="experience-title">宇宙很远。出发很简单。</h2></div><p>一艘飞船，一个航向。<br>慢慢巡航，或跃迁到下一个世界。</p></div><div class="experience-grid"><article class="warp-feature"><div class="warp-lines" aria-hidden="true"></div><div class="warp-emblem" aria-hidden="true">${orbit}</div><span class="feature-index">01 / HYPERDRIVE</span><div class="feature-copy"><span class="feature-tag">跃迁引擎</span><h3>跨越距离，<br>奔赴下一颗星球。</h3><p>选定目的地，按下 J。蓄能、穿越航道、减速抵达，完整感受一次星际跃迁。</p><a class="text-link" href="${flightLink}">体验跃迁 ${arrow}</a></div><span class="warp-caption">CHARGE → TRANSIT → ARRIVAL</span></article><div class="feature-stack"><article class="small-feature"><span class="feature-index">02 / FREE FLIGHT</span><div class="feature-icon" aria-hidden="true">↗</div><h3>航向，由你决定。</h3><p>六轴自由驾驶，座舱与外部视角随时切换。穿过蓝色大气与立体云层，在独立引擎面板拖动五档滑条，逐渐加减速接近目标；导航可收起。离地 10 千米以内使用低空航速，其他区域支持 1–150,000 km/s。按 L 着陆，按 E 离舱徒步；低重力下跳得更高、滞空更久，返回飞船后可再次起飞。</p><div class="key-row" aria-hidden="true"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>FREE TO EXPLORE</span></div></article><article class="small-feature"><span class="feature-index">03 / A CLOSER LOOK</span><div class="feature-icon" aria-hidden="true">◎</div><h3>让每次观测更清晰。</h3><p>真实天体比例，16K 地球影像与独立程序化星球细节。切换云层、大气与星空，在明暗交界处寻找细节。</p><a class="text-link" href="${observationLink("earth")}">进入行星观测 ${arrow}</a></article></div></div></section>
    <section class="guide wrap section" id="guide" aria-labelledby="guide-title"><div class="section-heading"><div><p class="section-kicker">03 / FLIGHT MANUAL</p><h2 id="guide-title">第一次出发，三步就绪。</h2></div><p>不需要航天知识。<br>带上好奇心，剩下的交给飞船。</p></div><ol class="guide-steps"><li><span>01</span><h3>进入驾驶舱</h3><p>点击“立即启航”，等待场景加载。手机可使用屏幕上的驾驶按钮。</p></li><li><span>02</span><h3>控制你的飞船</h3><p><kbd>W / S</kbd> 前进与减速，方向键转向。<kbd>Shift</kbd> 加速，<kbd>空格</kbd> 刹车，<kbd>C</kbd> 切换视角。</p></li><li><span>03</span><h3>选择下一站</h3><p>选择恒星系统与天体，按 <kbd>J</kbd> 启动跃迁。着陆后按 <kbd>E</kbd> 离舱，WASD 行走、空格跳跃、Shift 奔跑；走回飞船附近按 E 返回。</p></li></ol><div class="guide-note"><span>✳</span><p>旅程保存在当前浏览器。刷新后进入驾驶舱，点击“恢复存档”继续；清除浏览器数据会移除本机存档。</p><a href="${downloadLink}">下载离线版 ↗</a></div></section>
    <section class="closing wrap"><div><p class="section-kicker">THE UNIVERSE IS WAITING</p><h2>下一站，<span>由你命名。</span></h2><p>太阳系、双星与虚构脉冲星系已经就绪。你的旅程，现在开始。</p></div><a class="button button-primary" href="${flightLink}">进入驾驶舱 ${arrow}</a><span class="closing-orbit" aria-hidden="true">${orbit}</span></section>
  </main>
  <footer class="site-footer wrap"><div><a class="site-brand" href="#">${orbit}<span>星际探索<small>VOYAGER</small></span></a><p>探索，始于仰望。</p></div><div class="footer-right"><nav aria-label="项目链接"><a href="${repo}" target="_blank" rel="noopener noreferrer">GitHub ↗</a><a href="${repo}/blob/main/ASSETS.md" target="_blank" rel="noopener noreferrer">影像与许可 ↗</a><a href="${repo}/actions" target="_blank" rel="noopener noreferrer">更新记录 ↗</a></nav><p>银河为全景背景，行星方向为静态示意，航行动力学经过简化。</p><a class="build-version" href="${revision === "development" ? repo : `${repo}/commit/${revision}`}" target="_blank" rel="noopener noreferrer">当前版本 <span>${revision.slice(0, 7)}</span></a></div></footer>
`;

const menu = document.querySelector<HTMLButtonElement>(".menu-toggle")!;
const nav = document.querySelector<HTMLElement>(".site-nav")!;
menu.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  menu.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
  nav.classList.toggle("open", open);
});
nav.querySelectorAll("a").forEach((link) =>
  link.addEventListener("click", () => {
    menu.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-label", "打开导航");
    nav.classList.remove("open");
  }),
);
document
  .querySelectorAll<HTMLButtonElement>("[data-destination]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      const id = button.dataset.destination;
      if (!id || !isBodyId(id)) return;
      const body = getBody(id);
      document
        .querySelectorAll<HTMLButtonElement>("[data-destination]")
        .forEach((item) => {
          const selected = item === button;
          item.classList.toggle("selected", selected);
          item.setAttribute("aria-pressed", String(selected));
        });
      document.querySelector("#destination-number")!.textContent = String(
        SOLAR_SYSTEM.indexOf(body),
      ).padStart(2, "0");
      document.querySelector("#destination-english")!.textContent =
        `${body.english} / ${body.caption}`;
      document.querySelector("#destination-name")!.textContent = body.name;
      document.querySelector("#destination-description")!.textContent =
        body.description.replace(/<br\s*\/?\s*>/g, "");
      document.querySelector("#destination-radius")!.innerHTML =
        `${body.radiusKm.toLocaleString("zh-CN")} <small>km</small>`;
      const system = getBodySystem(body);
      document.querySelector("#destination-radius-label")!.textContent = body.kind === "black-hole" ? "阴影视觉半径" : body.id === "echo-pulsar" ? "视觉半径 · 艺术放大" : ["ruin", "shard"].includes(body.id) ? "残骸视觉包络" : body.systemId === "barnard" && body.kind === "planet" ? "示意半径 · 非实测" : "平均半径";
      document.querySelector("#destination-distance-label")!.textContent = ["black-hole", "echo-rift"].includes(body.systemId ?? "") ? "航区距离 · 虚构" : body.systemId && body.systemId !== "solar" ? "距太阳近似距离" : "距太阳平均距离";
      document.querySelector("#destination-distance")!.innerHTML = body.systemId && body.systemId !== "solar"
        ? `${Math.hypot(...system.positionLy).toFixed(3)} <small>光年</small>`
        : `${(body.distanceFromSunMillionKm / 149.5978707).toFixed(3)} <small>AU</small>`;
      const link =
        document.querySelector<HTMLAnchorElement>("#destination-link")!;
      link.href = observationLink(id);
      link.setAttribute("aria-label", `观测${body.name}`);
    }),
  );
watchSiteVersion();
