// Offscreen check of the Doom note app's sound and game, in headless Chromium.
// Usage: node check-sound.mjs <project dir> <evidence dir>   (playwright-core must be resolvable;
// set CHROME to a headless Chromium binary). Serves the project from a local http server on a
// free port inside this process, drives the page with the browser's own automation protocol
// (no OS-level input), and writes report.json + screenshots to the evidence dir.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const [projectDir, evidenceDir] = process.argv.slice(2).map((p) => path.resolve(p));
fs.mkdirSync(evidenceDir, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".md": "text/plain" };
const server = http.createServer((req, res) => {
  const file = path.join(projectDir, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/$/, "/index.html"));
  if (!file.startsWith(projectDir) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const report = { url, startedAt: new Date().toISOString(), checks: {}, failures: [] };
const fail = (m) => { report.failures.push(m); console.log("FAIL", m); };

const launched = await chromium.launchServer({
  executablePath: process.env.CHROME,
  headless: true,
  // Enforce the normal autoplay rule: no sound until the person interacts.
  args: ["--autoplay-policy=document-user-activation-required", "--mute-audio"],
});
report.browserPid = launched.process().pid;
const browser = await chromium.connect(launched.wsEndpoint());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 648 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error") report.failures.push("console: " + m.text()); });
  page.on("pageerror", (e) => fail("page error: " + e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.doom && window.doom.state !== "loading", null, { timeout: 30000 });
  await sleep(2000);

  // 1. Before any interaction: no AudioContext, nothing playing.
  const before = await page.evaluate(() => ({ state: doom.state, audio: doom.audio.state, frames: doom.frames, error: doom.error || null }));
  report.checks.beforeInteraction = before;
  if (before.state !== "running") fail("game not running: " + before.error);
  if (before.audio !== "none") fail("audio started before interaction: " + before.audio);
  await page.locator("#screen").screenshot({ path: path.join(evidenceDir, "1-title-before-click.png") });

  // Taps on the effects bus and the music bus, measured from inside the page.
  const installTaps = () => page.evaluate(() => {
    const a = doom.audio, ctx = a.ctx;
    const tap = (bus) => {
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      bus.connect(an);
      const buf = new Float32Array(an.fftSize);
      const t = { peak: 0, sumSq: 0, n: 0, loudWindows: 0, windows: 0 };
      t.timer = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let p = 0, s = 0;
        for (const v of buf) { const x = Math.abs(v); if (x > p) p = x; s += v * v; }
        t.windows++;
        if (p > 0.001) t.loudWindows++;
        if (p > t.peak) t.peak = p;
        t.sumSq += s; t.n += buf.length;
      }, 40);
      return t;
    };
    window.__taps = { sfx: tap(a.sfxBus), music: tap(a.musicBus), master: tap(a.master) };
  });
  const readTaps = () => page.evaluate(() => {
    const out = {};
    for (const [k, t] of Object.entries(window.__taps)) {
      out[k] = { peak: +t.peak.toFixed(4), rms: +Math.sqrt(t.sumSq / Math.max(1, t.n)).toFixed(4), windows: t.windows, nonSilentWindows: t.loudWindows };
      t.peak = 0; t.sumSq = 0; t.n = 0; t.loudWindows = 0; t.windows = 0;
    }
    return out;
  });

  // 2. First click (CDP mouse event inside the page) starts the audio.
  await page.locator("#screen").click();
  await page.waitForFunction(() => doom.audio.state === "running", null, { timeout: 5000 }).catch(() => {});
  const afterClick = await page.evaluate(() => ({ audio: doom.audio.state, sampleRate: doom.audio.ctx && doom.audio.ctx.sampleRate, pump: typeof doom.audio.pump }));
  report.checks.afterClick = afterClick;
  if (afterClick.audio !== "running") fail("AudioContext not running after click: " + afterClick.audio);
  await installTaps();

  // 3. Title music (D_INTRO, OPL) with no effects playing.
  await sleep(3000);
  report.checks.titleMusic = await readTaps();
  if (!(report.checks.titleMusic.music.peak > 0.01)) fail("no music samples on the title screen");

  // 4. Open the menu (Esc plays DSSWTCHN), measure effects.
  await page.keyboard.press("Escape");
  await sleep(600);
  report.checks.menuSound = await readTaps();
  if (!(report.checks.menuSound.sfx.peak > 0.01)) fail("menu sound produced no samples");
  await page.locator("#screen").screenshot({ path: path.join(evidenceDir, "2-menu.png") });

  // 5. New game: Enter on New Game, episode, skill. Then fire the pistol and move.
  for (const k of ["Enter", "Enter", "Enter"]) { await page.keyboard.press(k); await sleep(400); }
  await sleep(1500);
  await readTaps(); // drop the menu/level-start part
  await page.locator("#screen").screenshot({ path: path.join(evidenceDir, "3-gameplay.png") });
  const framesBefore = await page.evaluate(() => doom.frames);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.down("Control"); await sleep(150); await page.keyboard.up("Control"); await sleep(350);
  }
  report.checks.firing = await readTaps();
  if (!(report.checks.firing.sfx.peak > 0.01)) fail("firing produced no effect samples");
  if (!(report.checks.firing.music.peak > 0.01)) fail("no level music (E1M1) while playing");
  await page.locator("#screen").screenshot({ path: path.join(evidenceDir, "4-fired.png") });

  // 6. Keys still move the player: turn left for a second, compare the frames.
  const shot = async () => page.locator("#screen").screenshot();
  const a = await shot();
  await page.keyboard.down("ArrowLeft"); await sleep(1000); await page.keyboard.up("ArrowLeft");
  await page.keyboard.down("ArrowUp"); await sleep(600); await page.keyboard.up("ArrowUp");
  await sleep(200);
  const b = await shot();
  fs.writeFileSync(path.join(evidenceDir, "5-turned-and-moved.png"), b);
  const framesAfter = await page.evaluate(() => doom.frames);
  report.checks.keys = { framesBefore, framesAfter, frameImageChanged: !a.equals(b) };
  if (!(framesAfter > framesBefore)) fail("no frames drawn");
  if (a.equals(b)) fail("turning didn't change the picture");

  // 7. Channel state: a shot shows as playing on a channel, and once the sound ends the channel
  // reports not playing (so Doom frees it).
  await sleep(2500);
  const playingNow = () => page.evaluate(() => [...Array(8).keys()].map((c) => doom.audio.playing(c)));
  const quietBefore = await playingNow();
  // Poll every 10 ms from inside the page while one shot goes off (the pistol sounds a few tics
  // after the key goes down); keep the first moment any channel reports playing.
  const polling = page.evaluate(() => new Promise((resolve) => {
    const t0 = performance.now();
    const id = setInterval(() => {
      const p = [...Array(8).keys()].map((c) => doom.audio.playing(c));
      if (p.some(Boolean) || performance.now() - t0 > 1500) { clearInterval(id); resolve({ ms: Math.round(performance.now() - t0), playing: p }); }
    }, 10);
  }));
  await page.keyboard.down("Control"); await sleep(150); await page.keyboard.up("Control");
  const firstPlaying = await polling;
  const duringFire = firstPlaying.playing;
  await sleep(2500);
  const afterQuiet = await playingNow();
  report.checks.channels = { quietBefore, duringFire, msAfterKeyDown: firstPlaying.ms, afterQuiet };
  if (!duringFire.some(Boolean)) fail("no channel playing right after a shot");
  if (afterQuiet.some(Boolean)) fail("a channel still reports playing after its sound ended");

  // 8. Record 8 s of the mixed output (music + a few shots) for listening, with a MediaRecorder
  // (it records off the page's thread, so the recording itself can't drop audio).
  const gapsBefore = await page.evaluate(() => doom.audio.musicGaps);
  await page.evaluate(() => {
    const a = doom.audio, ctx = a.ctx;
    const dest = ctx.createMediaStreamDestination();
    a.master.connect(dest);
    const rec = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 192000 });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    window.__rec = { rec, chunks, dest };
  });
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0) { await page.keyboard.down("Control"); await sleep(200); await page.keyboard.up("Control"); }
    await sleep(800);
  }
  const webm = await page.evaluate(async () => {
    const { rec, chunks, dest } = window.__rec;
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    doom.audio.master.disconnect(dest);
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  fs.writeFileSync(path.join(evidenceDir, "6-gameplay-audio.webm"), Buffer.from(webm));
  const gapsAfter = await page.evaluate(() => doom.audio.musicGaps);
  report.checks.recording = { file: "6-gameplay-audio.webm", bytes: webm.length, musicGapsDuringRecording: gapsAfter - gapsBefore, musicGapsTotal: gapsAfter };
  report.checks.final = await page.evaluate(() => ({ audio: doom.audio.state, frames: doom.frames, tics: doom.tics, busyMsPerTic: +(doom.busyMs / doom.tics).toFixed(3), log: doom.log.slice(-12) }));
} catch (e) {
  fail("exception: " + (e.stack || e));
} finally {
  await browser.close().catch(() => {});
  await launched.close().catch(() => {});
  server.close();
}
report.passed = report.failures.length === 0;
fs.writeFileSync(path.join(evidenceDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
