// Doom in a note: loads the engine (doom.wasm) and the shareware game data (DOOM1.WAD) from this
// app's own files, as they are (fetch, like any web page), then runs it on the canvas. The WAD is
// checked against id's shareware v1.9 SHA-1 before it runs. Sound starts with the first click or key.
(async () => {
  const status = document.getElementById("status");
  const canvas = document.getElementById("screen");
  const ctx = canvas.getContext("2d");
  const say = (t) => { status.textContent = t; };
  // The note's title at the top of the page, as Pinto shows a note's title; it follows a rename.
  const bridge = window.pinto || window.amber;
  const heading = document.getElementById("title");
  const showTitle = (note) => { if (heading && note && note.title) heading.textContent = note.title; };
  if (bridge) { showTitle(bridge.note); if (bridge.onChange) bridge.onChange((note) => showTitle(note)); }
  const doom = (window.doom = { state: "loading", frames: 0, tics: 0, log: [] });
  const WAD_SHA1 = "5b2e249b9c5133ec987b3ea77596381dc0d6bc1d";

  const load = async (path) => {
    const r = await fetch("/" + path);
    if (!r.ok) throw new Error("Missing " + path);
    return new Uint8Array(await r.arrayBuffer());
  };
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  // Sound, with Web Audio. Browsers allow sound only after the person interacts with the page,
  // so the audio starts on the first click, tap or key; nothing plays before that.
  // Effects: the engine hands over each of Doom's 8 channels (the WAD's 8-bit samples, volume
  // 0-127, stereo separation 0-254). Music: the engine's OPL synthesizer renders short blocks
  // that are queued a little ahead of the playback clock, so a busy moment on the page doesn't
  // cut the music. doom.audio exposes the nodes for checks.
  const audio = (doom.audio = (() => {
    let ctx = null, master = null, sfxBus = null, musicBus = null, engine = null;
    let musicAt = 0; // playback time where the next music block starts
    const MUSIC_BLOCK = 1024, MUSIC_AHEAD = 0.2; // samples per block; seconds queued ahead
    const buffers = new Map(); // WAD lump number -> AudioBuffer
    const channels = []; // Doom channel -> { src, gain, pan, endsAt }

    const toBuffer = (bytes, rate) => {
      // 8-bit unsigned samples, 128 is silence.
      let buffer;
      try {
        buffer = ctx.createBuffer(1, bytes.length, rate);
        const d = buffer.getChannelData(0);
        for (let i = 0; i < bytes.length; i++) d[i] = (bytes[i] - 128) / 128;
      } catch {
        // A browser that can't make a buffer at the sound's own rate: resample to the output's.
        const n = Math.max(1, Math.round((bytes.length * ctx.sampleRate) / rate));
        buffer = ctx.createBuffer(1, n, ctx.sampleRate);
        const d = buffer.getChannelData(0);
        for (let i = 0; i < n; i++) {
          const x = (i * rate) / ctx.sampleRate, j = Math.floor(x), f = x - j;
          const a = bytes[Math.min(j, bytes.length - 1)], b = bytes[Math.min(j + 1, bytes.length - 1)];
          d[i] = (a + (b - a) * f - 128) / 128;
        }
      }
      return buffer;
    };

    const params = (ch, vol, sep) => {
      const c = channels[ch];
      if (!c) return;
      c.gain.gain.value = (vol / 127) * 0.8;
      if (c.pan) c.pan.pan.value = Math.max(-1, Math.min(1, (sep - 128) / 127));
    };
    const stop = (ch) => {
      const c = channels[ch];
      if (!c) return;
      channels[ch] = null;
      try { c.src.stop(); } catch {}
      c.src.disconnect();
    };
    const start = (ch, lump, bytes, rate, vol, sep) => {
      stop(ch);
      if (!ctx || ctx.state !== "running") return;
      let buffer = buffers.get(lump);
      if (!buffer) buffers.set(lump, (buffer = toBuffer(bytes, rate)));
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      src.connect(gain);
      if (pan) gain.connect(pan).connect(sfxBus); else gain.connect(sfxBus);
      const c = { src, gain, pan, endsAt: ctx.currentTime + buffer.duration };
      src.onended = () => { if (channels[ch] === c) channels[ch] = null; src.disconnect(); gain.disconnect(); if (pan) pan.disconnect(); };
      channels[ch] = c;
      params(ch, vol, sep);
      src.start();
    };
    const playing = (ch) => {
      const c = channels[ch];
      return !!c && ctx.currentTime < c.endsAt;
    };

    // Music: called with every game tic. Keeps MUSIC_AHEAD seconds of music queued on the
    // playback clock, in blocks placed sample by sample. If the page stalls past the queue, the
    // music skips ahead from now (counted in api.musicGaps).
    let musicFrame = -1, rateSet = false;
    const pump = () => {
      if (!ctx || !engine || ctx.state !== "running") return;
      const rate = ctx.sampleRate;
      if (!rateSet) { engine._pinto_music_rate(rate); rateSet = true; }
      const now = ctx.currentTime;
      if (musicFrame < 0 || musicFrame / rate < now + 0.01) {
        if (musicFrame >= 0) api.musicGaps++;
        musicFrame = Math.ceil((now + 0.05) * rate);
      }
      while (musicFrame / rate < now + MUSIC_AHEAD) {
        const ptr = engine._pinto_music_render(MUSIC_BLOCK);
        const s = new Int16Array(engine.HEAPU8.buffer, ptr, MUSIC_BLOCK);
        const buffer = ctx.createBuffer(1, MUSIC_BLOCK, rate);
        const d = buffer.getChannelData(0);
        for (let i = 0; i < MUSIC_BLOCK; i++) d[i] = s[i] / 32768;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(musicBus);
        src.start(musicFrame / rate);
        musicFrame += MUSIC_BLOCK;
      }
    };

    const unlock = () => {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        // 44.1 kHz is the rate the music synthesizer runs at; the browser resamples if it must.
        try { ctx = new AC({ sampleRate: 44100, latencyHint: "interactive" }); } catch { ctx = new AC(); }
        master = ctx.createGain();
        master.connect(ctx.destination);
        sfxBus = ctx.createGain();
        sfxBus.connect(master);
        musicBus = ctx.createGain();
        musicBus.connect(master);
        Object.assign(api, { ctx, master, sfxBus, musicBus });
      }
      if (ctx.state !== "running" && !document.hidden) ctx.resume().catch(() => {});
    };
    // Every event a browser counts as the person's own action. Kept on, so sound comes back
    // with the next touch if the system suspends it (a call, another app).
    for (const type of ["pointerdown", "pointerup", "mousedown", "touchend", "keydown"]) {
      addEventListener(type, unlock, { capture: true, passive: true });
    }
    // The game slows to a crawl when the page is hidden, so the sound stops with it.
    document.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend().catch(() => {});
      else ctx.resume().catch(() => {});
    });

    const api = {
      start, params, stop, playing, pump, musicGaps: 0,
      attach: (Module) => { engine = Module; },
      get state() { return ctx ? ctx.state : "none"; },
    };
    return api;
  })());

  try {
    const t0 = performance.now();
    const [wasm, wad] = await Promise.all([load("doom.wasm"), load("doom1.wad")]);
    if (wad.length !== 4196020) throw new Error("DOOM1.WAD is " + wad.length + " bytes, not 4,196,020.");
    if (crypto.subtle) {
      doom.wadSha1 = hex(await crypto.subtle.digest("SHA-1", wad));
      if (doom.wadSha1 !== WAD_SHA1) throw new Error("DOOM1.WAD doesn't match id's shareware v1.9 file.");
    }
    doom.loadMs = Math.round(performance.now() - t0);

    const Module = await DoomModule({
      // The engine's bytes come from this app's files: compiled here, not fetched by the loader.
      instantiateWasm: (imports, done) => {
        WebAssembly.instantiate(wasm, imports).then((r) => done(r.instance), (e) => { doom.state = "failed"; doom.error = String(e); say("Doom couldn't start: " + e); });
        return {};
      },
      pintoAudio: audio, // the engine's sound effects go here (pinto_sound.c)
      print: (t) => doom.log.push(t),
      printErr: (t) => doom.log.push(t),
    });
    audio.attach(Module);
    Module.FS.writeFile("/doom1.wad", wad);
    Module.callMain(["-iwad", "/doom1.wad"]);
    doom.startMs = Math.round(performance.now() - t0);

    const image = ctx.createImageData(320, 200);
    const out = new Uint32Array(image.data.buffer);
    const screen = Module._pinto_screen();
    let drawn = -1;
    const draw = () => {
      const f = Module._pinto_frames();
      if (f === drawn) return;
      drawn = f;
      // Doom's pixels are 0x00RRGGBB; the canvas wants R, G, B, A in memory.
      const src = new Uint32Array(Module.HEAPU8.buffer, screen, 320 * 200);
      for (let i = 0; i < src.length; i++) {
        const p = src[i];
        out[i] = 0xff000000 | ((p & 0xff) << 16) | (p & 0xff00) | ((p >>> 16) & 0xff);
      }
      ctx.putImageData(image, 0, 0);
      doom.frames++;
    };
    // One game tic is 1/35 s. Tick only when one is due, so the engine never waits inside a frame.
    const tic = 1000 / 35;
    let next = performance.now();
    doom.step = (n = 1) => { for (let i = 0; i < n; i++) { Module._doomgeneric_Tick(); doom.tics++; } draw(); audio.pump(); };
    // How long each tic and its frame take (doom.busyMs / doom.tics), for the frame rate it could reach.
    doom.busyMs = 0;
    const loop = () => {
      const now = performance.now();
      if (now >= next) {
        doom.step(1);
        doom.busyMs += performance.now() - now;
        next += tic;
        if (now - next > 250) next = now + tic;
      }
      setTimeout(loop, Math.max(0, next - performance.now()));
    };
    loop();

    // Keys: the page's own keyboard events, Doom's default controls.
    const special = {
      ArrowLeft: 0xac, ArrowRight: 0xae, ArrowUp: 0xad, ArrowDown: 0xaf,
      Enter: 13, Escape: 27, Tab: 9, Backspace: 0x7f, " ": 0xa2,
      Control: 0xa3, Shift: 0x80 + 0x36, Alt: 0x80 + 0x38,
      F1: 0x80 + 0x3b, F2: 0x80 + 0x3c, F3: 0x80 + 0x3d, F4: 0x80 + 0x3e, F5: 0x80 + 0x3f,
      F6: 0x80 + 0x40, F7: 0x80 + 0x41, F8: 0x80 + 0x42, F9: 0x80 + 0x43, F10: 0x80 + 0x44, F11: 0x80 + 0x57,
      "=": 0x3d, "+": 0x3d, "-": 0x2d,
    };
    const code = (e) => {
      if (e.key in special) return special[e.key];
      if (e.key.length === 1) return e.key.toLowerCase().charCodeAt(0) & 0xff;
      return 0;
    };
    // The keys line goes quiet once you're playing (a move or a shot), and comes back with the menu.
    const playKeys = new Set([0xac, 0xae, 0xad, 0xaf, 0xa3]);
    const hint = (shown) => status.classList.toggle("gone", !shown);
    const key = (pressed) => (e) => {
      if (e.metaKey) return; // the app's own shortcuts
      const k = code(e);
      if (!k) return;
      e.preventDefault();
      if (pressed && playKeys.has(k)) hint(false);
      if (pressed && k === 27) hint(true);
      if (pressed && e.repeat) return;
      Module._pinto_key(pressed ? 1 : 0, k);
    };
    addEventListener("keydown", key(true));
    addEventListener("keyup", key(false));
    canvas.addEventListener("pointerdown", () => canvas.focus());
    canvas.focus();

    doom.state = "running";
    say("Arrows move, Ctrl fires, Space opens doors, Esc for the menu.");
  } catch (e) {
    doom.state = "failed";
    doom.error = String((e && e.message) || e);
    say("Doom couldn't start: " + doom.error);
    throw e;
  }
})();
