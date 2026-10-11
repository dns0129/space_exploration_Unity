/** Shows a new deployment without interrupting an active flight. */
export function watchSiteVersion() {
  if (import.meta.env.VITE_PUBLIC_SITE !== "true") return;
  const revision = import.meta.env.VITE_SITE_REVISION;
  let checking = false;
  let banner: HTMLElement | undefined;
  const check = async () => {
    if (document.hidden || checking || banner || !navigator.onLine) return;
    checking = true;
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        },
      );
      if (!response.ok) return;
      const current = await response.json();
      if (
        typeof current.revision !== "string" ||
        !/^[a-f0-9]{40}$/.test(current.revision) ||
        current.revision === revision
      )
        return;
      banner = document.createElement("aside");
      banner.className = "site-update";
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");
      banner.innerHTML = "<span>新版本已上线</span><button>刷新体验</button>";
      banner.style.cssText =
        "position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:5000;display:flex;align-items:center;gap:18px;padding:12px 18px;border:1px solid #dce89e66;border-radius:8px;background:#10151ef5;color:#edf0e5;font:14px system-ui;box-shadow:0 12px 40px #0008;white-space:nowrap";
      const refresh = banner.querySelector("button")!;
      refresh.style.cssText =
        "padding:8px 13px;border:0;border-radius:4px;background:#dce89e;color:#161c10;font:inherit;cursor:pointer";
      refresh.addEventListener("click", () => {
        const url = new URL(location.href);
        url.searchParams.set("build", current.revision);
        location.replace(url);
      });
      document.body.append(banner);
    } catch {
      // The current game remains usable during a connection interruption.
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => void check(), 60_000);
  const visible = () => {
    if (!document.hidden) void check();
  };
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("focus", visible);
  window.addEventListener(
    "pagehide",
    () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    },
    { once: true },
  );
  void check();
}
