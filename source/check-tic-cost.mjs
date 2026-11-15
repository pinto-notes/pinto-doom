// Compares the time the page spends per game tic (doom.busyMs / doom.tics: tic + frame draw)
// between two builds of the Doom note app, in headless Chromium, and the main-thread time the
// music renderer takes (the ScriptProcessor callback). Usage:
//   node check-tic-cost.mjs <old project> <new project> <out.json>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const [oldDir, newDir, outFile] = process.argv.slice(2).map((p) => path.resolve(p));
const serve = async (dir) => {
  const s = http.createServer((req, res) => {
    const f = path.join(dir, new URL(req.url, "http://x").pathname.replace(/^\/$/, "/index.html"));
    if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": f.endsWith(".wasm") ? "application/wasm" : f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return s;
};
const launched = await chromium.launchServer({ executablePath: process.env.CHROME, headless: true, args: ["--autoplay-policy=document-user-activation-required", "--mute-audio"] });
const browser = await chromium.connect(launched.wsEndpoint());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { browserPid: launched.process().pid };
const measure = async (dir, label, click) => {
  const s = await serve(dir);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${s.address().port}/`);
  await page.waitForFunction(() => window.doom && doom.state === "running", null, { timeout: 30000 });
  if (click) await page.locator("#screen").click();
  await sleep(1500);
  // Time the music callback too, by wrapping it.
  await page.evaluate(() => {
    doom.busyMs = 0; doom.tics = 0;
    window.__music = { ms: 0, calls: 0 };
    const a = doom.audio;
    if (a && a.pump) { const f = a.pump; a.pump = () => { const t = performance.now(); f(); __music.ms += performance.now() - t; __music.calls++; }; }
  });
  await sleep(6000);
  out[label] = await page.evaluate(() => ({ tics: doom.tics, busyMsPerTic: +(doom.busyMs / doom.tics).toFixed(3), audio: doom.audio ? doom.audio.state : "n/a", musicMsPerSecond: +(__music.ms / 6).toFixed(2), musicCalls: __music.calls }));
  await page.close();
  s.close();
};
try {
  await measure(oldDir, "old", false);
  await measure(newDir, "newBeforeClick", false);
  await measure(newDir, "newWithSound", true);
} finally {
  await browser.close().catch(() => {});
  await launched.close().catch(() => {});
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
