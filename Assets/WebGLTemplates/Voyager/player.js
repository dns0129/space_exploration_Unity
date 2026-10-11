(() => {
  const canvas = document.getElementById('unity-canvas');
  const loading = document.getElementById('loading');
  const title = document.getElementById('loading-title');
  const text = document.getElementById('loading-text');
  const progress = document.getElementById('progress');
  let revision = '';
  function fail(error) {
    loading.hidden = false; title.textContent = '暂时无法启航';
    text.textContent = '请检查网络并使用支持 WebGL 2 的桌面浏览器。详情：' + String(error);
    progress.hidden = true; document.getElementById('retry').hidden = false;
  }
  document.getElementById('retry').addEventListener('click', () => location.reload());
  document.getElementById('refresh').addEventListener('click', () => location.reload());
  document.getElementById('fullscreen').addEventListener('click', async () => {
    try { await canvas.parentElement.requestFullscreen(); canvas.focus(); }
    catch { document.getElementById('message').textContent = '此浏览器暂不支持全屏，请直接在页面中航行。'; }
  });
  canvas.addEventListener('click', () => canvas.focus());
  canvas.addEventListener('keydown', event => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  });
  window.addEventListener('voyager-ready', () => {
    loading.hidden = true; canvas.focus();
  });
  window.addEventListener('voyager-message', event => {
    document.getElementById('message').textContent = event.detail;
    if (document.documentElement.dataset.gameReady !== 'true') fail(event.detail);
  });
  async function checkVersion() {
    try {
      const response = await fetch('version.json?t=' + Date.now(), {cache: 'no-store'});
      if (!response.ok) return;
      const version = await response.json();
      if (!/^[a-f0-9]{40}$/.test(version.revision)) return;
      if (!revision) {
        revision = version.revision;
        const label = document.getElementById('revision');
        label.textContent = revision.slice(0, 7); label.title = revision;
      } else if (revision !== version.revision) document.getElementById('new-version').hidden = false;
    } catch { /* Version polling does not interrupt the running game. */ }
  }
  checkVersion(); setInterval(checkVersion, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
  if (!window.WebAssembly || !document.createElement('canvas').getContext('webgl2')) {
    fail('需要 WebAssembly 和 WebGL 2。'); return;
  }
  const config = window.voyagerConfig;
  config.showBanner = (message, type) => {
    if (type === 'error') fail(message); else console.warn(message);
  };
  const script = document.createElement('script'); script.src = config.loaderUrl;
  script.onerror = () => fail('Unity 加载器下载失败。');
  script.onload = async () => {
    try {
      window.voyagerInstance = await createUnityInstance(canvas, config, value => {
        progress.value = value;
        if (value >= 1) { title.textContent = '正在准备星图'; text.textContent = '游戏引擎已启动，正在下载天体与地形数据…'; }
      });
    } catch (error) { fail(error); }
  };
  document.body.appendChild(script);
})();
