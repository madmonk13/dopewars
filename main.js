// Device shell: scaling, silkscreen/hardware buttons, keyboard, a tiny launcher, and the
// Palm / Screen / Modern view picker.
(function () {
  "use strict";
  const P = PalmOS;
  const canvas = document.getElementById("screen");
  const kbd = document.getElementById("kbd");
  const app = document.getElementById("app");
  const stage = document.querySelector(".stage");
  const VIEW_KEY = "dopewars-2.4.6/view";
  let view = "palm";
  let running = false;

  // ---------------------------------------------------------------- scale to fit
  function fit() {
    let s;
    if (view === "screen") {
      const cs = getComputedStyle(stage);
      const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 4;
      const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 4;
      // fill the window: largest square that fits, fractional scale allowed
      s = Math.max(1, Math.min(w / 160, h / 160));
    } else {
      const availW = Math.min(window.innerWidth - 32, 900);
      const availH = window.innerHeight - 32 - 50; // 50: style picker under the device
      // device is roughly 1.15 screen widths wide and 1.9 screen heights tall
      s = Math.min(availW / (160 * 1.15), availH / (160 * 1.9));
      // whole-number scaling keeps pixels crisp; small phones get a fractional scale instead of 1x
      s = s >= 2 ? Math.min(Math.floor(s), 5) : Math.max(1, s);
    }
    document.documentElement.style.setProperty("--s", s);
  }
  window.addEventListener("resize", fit);

  // ---------------------------------------------------------------- view picker
  function setView(v) {
    view = v;
    app.classList.toggle("palm", v === "palm");
    app.classList.toggle("screen", v === "screen");
    app.classList.toggle("modern", v === "modern");
    document.querySelectorAll(".style-bar [data-view]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.view === v)));
    const css = getComputedStyle(document.documentElement);
    document.querySelector('meta[name="theme-color"]').content = (v === "modern" ? css.getPropertyValue("--m-bg") : css.getPropertyValue("--bg")).trim();
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* private mode */ }
    ModernView.setEnabled(v === "modern");
    fit();
  }
  document.querySelectorAll(".style-bar [data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  // Modern style shows its own launcher while the app isn't running (after Home)
  document.getElementById("mlauncherIcon").src = (PRC.bitmaps.Tbmp_9502["8"] || PRC.bitmaps.Tbmp_9502["1"]).src;
  const setRunning = (r) => { running = r; app.classList.toggle("idle", !r); };

  // ---------------------------------------------------------------- launcher (Home)
  const ICON = { x: 10, y: 22, w: 36, h: 44 };
  function drawLauncher() {
    P.clearScreen();
    const now = new Date();
    const h = now.getHours() % 12 || 12;
    const time = `${h}:${String(now.getMinutes()).padStart(2, "0")} ${now.getHours() < 12 ? "am" : "pm"}`;
    const tw = P.FntCharsWidth(time, 1) + 4;
    P.ink(0, 0, tw, 11);
    P.drawText(time, 2, 0, 1, true);
    P.ink(0, 11, 160, 2);
    P.drawText("All", 140, 0, 0);
    P.ink(133, 4, 5, 1); P.ink(134, 5, 3, 1); P.ink(135, 6, 1, 1);
    P.drawBitmap("icon1000", ICON.x + 2, ICON.y);
    const label = "DopeWars";
    P.drawText(label, ICON.x + Math.floor((ICON.w - P.FntCharsWidth(label, 0)) / 2), ICON.y + 33, 0);
  }
  P.onIdleTap = (x, y) => {
    if (running) return;
    if (x >= ICON.x && x < ICON.x + ICON.w && y >= ICON.y && y < ICON.y + ICON.h) launch();
  };

  async function launch() {
    if (running) return;
    setRunning(true);
    P.clearScreen();
    try {
      await DopeWars.PilotMain();
    } catch (e) {
      console.error(e);
    }
    setRunning(false);
    drawLauncher();
  }

  function home() {
    if (running) P.EvtAddEvent({ eType: P.ev.appStopEvent });
    else drawLauncher();
  }

  // ---------------------------------------------------------------- buttons
  document.querySelectorAll("[data-act]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.preventDefault();
      const act = b.dataset.act;
      if (act === "home") home();
      else if (act === "launch") launch();
      else if (act === "menu" && running) P.openMenu();
      else if (act === "abc" || act === "123") openKeyboard(act === "123");
      else if (act === "up") P.scroll(-1);
      else if (act === "down") P.scroll(1);
    })
  );

  // ---------------------------------------------------------------- keyboard
  document.addEventListener("keydown", (e) => {
    if (!running || e.metaKey) return;
    if (e.target === kbd || e.target.matches("input, textarea, button")) return;
    if ((e.ctrlKey || e.altKey) && /^[a-z]$/i.test(e.key)) {
      if (P.menuShortcut(e.key)) e.preventDefault();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "PageUp") { P.scroll(-1); e.preventDefault(); return; }
    if (e.key === "ArrowDown" || e.key === "PageDown") { P.scroll(1); e.preventDefault(); return; }
    if (e.key === "Backspace") { P.keyDown(8); e.preventDefault(); return; }
    if (e.key === "Escape") { P.keyDown(27); return; }
    if (e.key.length === 1 && e.key.charCodeAt(0) <= 0xff) {
      P.keyDown(e.key.charCodeAt(0));
      e.preventDefault();
    }
  });

  // Hidden input so phones show their keyboard; a sentinel char lets us see backspaces.
  const SENTINEL = "_";
  function openKeyboard(numeric) {
    kbd.setAttribute("inputmode", numeric ? "numeric" : "text");
    kbd.value = SENTINEL;
    kbd.focus({ preventScroll: true });
  }
  kbd.addEventListener("input", () => {
    const v = kbd.value;
    if (v.length < SENTINEL.length) P.keyDown(8);
    else for (const ch of v.slice(SENTINEL.length)) if (ch.charCodeAt(0) <= 0xff) P.keyDown(ch.charCodeAt(0));
    kbd.value = SENTINEL;
  });
  P.onFieldTap = () => {
    if (window.matchMedia("(pointer: coarse)").matches) openKeyboard(P.activeFieldNumeric);
  };

  // ---------------------------------------------------------------- save when the page goes away
  const save = () => { if (running) DopeWars.SaveApplicationState(); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
  window.addEventListener("pagehide", save);

  // ---------------------------------------------------------------- boot
  let saved = "palm";
  try { saved = localStorage.getItem(VIEW_KEY) || "palm"; } catch (e) { /* private mode */ }
  P.init(canvas);
  setView(["palm", "screen", "modern"].includes(saved) ? saved : "palm");
  P.loadImages().then(launch);

  // ---------------------------------------------------------------- installable app (offline)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("service worker:", e));
  }
})();
