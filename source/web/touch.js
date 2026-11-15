// Touch controls for phones: a move pad, Fire, Use and Menu, shown only on a touch screen
// (pointer: coarse). They send the same keyboard events main.js already handles, on window.
// Use also sends Enter, so it picks menu items; Menu sends Escape, which also backs out of menus.
(() => {
  const mq = matchMedia("(pointer: coarse)");
  const held = new Map(); // key -> how many controls hold it down
  let ui = null;

  const send = (type, key) => dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
  const press = (key) => {
    const n = held.get(key) || 0;
    held.set(key, n + 1);
    if (n === 0) send("keydown", key);
  };
  const lift = (key) => {
    const n = held.get(key) || 0;
    if (n <= 1) { held.delete(key); if (n === 1) send("keyup", key); } else held.set(key, n - 1);
  };
  const liftAll = () => {
    for (const key of [...held.keys()]) { held.set(key, 1); lift(key); }
    if (ui) ui.reset();
  };

  const css = `
    html.doom-touch, html.doom-touch body { touch-action: none; overscroll-behavior: none;
      -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    @media (orientation: portrait) {
      html.doom-touch body { justify-content: flex-start;
        padding-top: calc(env(safe-area-inset-top) + 60px); box-sizing: border-box; }
      html.doom-touch #screen { width: min(100vw, calc((100vh - 60px - 48px) * 4 / 3)); }
    }
    .dt { position: fixed; z-index: 10; touch-action: none; -webkit-tap-highlight-color: transparent;
      -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
      font: 600 15px -apple-system, system-ui, sans-serif; color: rgba(255,255,255,.9);
      background: rgba(255,255,255,.12); border: 1.5px solid rgba(255,255,255,.35);
      box-sizing: border-box; margin: 0; padding: 0; }
    .dt.on, .dt-pad.on .dt-knob { background: rgba(255,255,255,.32); border-color: rgba(255,255,255,.6); }
    .dt-pad { --size: clamp(112px, 36vmin, 156px); width: var(--size); height: var(--size); border-radius: 50%;
      left: calc(env(safe-area-inset-left) + 16px); bottom: calc(env(safe-area-inset-bottom) + 20px); }
    .dt-knob { position: absolute; left: 50%; top: 50%; width: 42%; height: 42%; border-radius: 50%;
      transform: translate(-50%, -50%); background: rgba(255,255,255,.22); border: 1.5px solid rgba(255,255,255,.45);
      box-sizing: border-box; pointer-events: none; }
    .dt-btn { border-radius: 50%; display: flex; align-items: center; justify-content: center; }
    .dt-fire { width: 80px; height: 80px; right: calc(env(safe-area-inset-right) + 16px);
      bottom: calc(env(safe-area-inset-bottom) + 56px); }
    .dt-use { width: 64px; height: 64px; right: calc(env(safe-area-inset-right) + 104px);
      bottom: calc(env(safe-area-inset-bottom) + 20px); }
    @media (orientation: landscape) {
      .dt-use { right: calc(env(safe-area-inset-right) + 24px); bottom: calc(env(safe-area-inset-bottom) + 152px); }
    }
    .dt-menu { height: 44px; min-width: 72px; padding: 0 16px; border-radius: 22px;
      top: calc(env(safe-area-inset-top) + 8px); left: calc(env(safe-area-inset-left) + 16px); }
  `;

  // One pointer per control, captured so a thumb that slides off keeps it held.
  const track = (el, { down, move, up }) => {
    let id = null;
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      el.classList.remove("on");
      up();
    };
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (id !== null) return;
      id = e.pointerId;
      try { el.setPointerCapture(id); } catch {}
      el.classList.add("on");
      down(e);
    });
    if (move) el.addEventListener("pointermove", (e) => { if (e.pointerId === id) { e.preventDefault(); move(e); } });
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    return () => { if (id !== null) { id = null; el.classList.remove("on"); } };
  };

  const button = (cls, label, text, keys) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "dt dt-btn " + cls;
    el.setAttribute("aria-label", label);
    el.textContent = text;
    const reset = track(el, { down: () => keys.forEach(press), up: () => keys.forEach(lift) });
    return { el, reset };
  };

  const pad = () => {
    const el = document.createElement("div");
    el.className = "dt dt-pad";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Move pad: drag up to walk, down to back up, left and right to turn");
    const knob = document.createElement("div");
    knob.className = "dt-knob";
    el.appendChild(knob);
    const DEAD = 0.3; // of the pad's radius
    let down = new Set();
    const set = (want) => {
      for (const k of down) if (!want.has(k)) lift(k);
      for (const k of want) if (!down.has(k)) press(k);
      down = want;
    };
    const aim = (e) => {
      const r = el.getBoundingClientRect();
      const radius = r.width / 2;
      let x = (e.clientX - (r.left + radius)) / radius;
      let y = (e.clientY - (r.top + radius)) / radius;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      knob.style.transform = `translate(calc(-50% + ${x * radius * 0.6}px), calc(-50% + ${y * radius * 0.6}px))`;
      const want = new Set();
      if (Math.hypot(x, y) > DEAD) {
        if (y < -DEAD) want.add("ArrowUp");
        if (y > DEAD) want.add("ArrowDown");
        if (x < -DEAD) want.add("ArrowLeft");
        if (x > DEAD) want.add("ArrowRight");
      }
      set(want);
    };
    const release = () => { knob.style.transform = ""; set(new Set()); };
    const reset = track(el, { down: aim, move: aim, up: release });
    return { el, reset: () => { reset(); knob.style.transform = ""; down = new Set(); } };
  };

  const enable = () => {
    if (ui) return;
    if (!document.querySelector('meta[name="viewport"]')) {
      const m = document.createElement("meta");
      m.name = "viewport";
      m.content = "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover";
      document.head.appendChild(m);
    }
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const parts = [
      pad(),
      button("dt-fire", "Fire", "Fire", ["Control"]),
      button("dt-use", "Use: open doors, pick menu items", "Use", [" ", "Enter"]),
      button("dt-menu", "Menu", "Menu", ["Escape"]),
    ];
    parts.forEach((p) => document.body.appendChild(p.el));
    document.documentElement.classList.add("doom-touch");
    // Once the game runs, main.js's status line names keyboard keys; on a phone, name the controls.
    const status = document.getElementById("status");
    const HINT = "The pad moves and turns, Fire shoots, Use opens doors and picks menu items.";
    let keyboardHint = null;
    const retitle = () => {
      if (!status || !window.doom || window.doom.state !== "running" || status.textContent === HINT) return;
      keyboardHint = status.textContent;
      status.textContent = HINT;
    };
    const watch = new MutationObserver(retitle);
    if (status) watch.observe(status, { childList: true, characterData: true, subtree: true });
    retitle();
    const restore = () => {
      watch.disconnect();
      if (keyboardHint !== null && status.textContent === HINT) status.textContent = keyboardHint;
    };
    ui = { style, parts, restore, reset: () => parts.forEach((p) => p.reset()) };
  };

  const disable = () => {
    if (!ui) return;
    liftAll();
    ui.parts.forEach((p) => p.el.remove());
    ui.style.remove();
    ui.restore();
    document.documentElement.classList.remove("doom-touch");
    ui = null;
  };

  const update = () => (mq.matches ? enable() : disable());
  mq.addEventListener("change", update);
  addEventListener("blur", liftAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) liftAll(); });
  update();
})();
