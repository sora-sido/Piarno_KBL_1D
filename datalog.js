/**
 * データ記録：カメラの関節座標・マイクの机の音・録音・アプリが鳴らした音を、同じ時計（performance.now）で記録する
 *
 * 書き出すファイル
 * - piarno_log_日時.json：コマごとの関節座標と、机の音・発音の時刻
 * - piarno_log_日時.wav ：マイクの録音（16bit モノラル）
 *
 * JSON の中身
 * - frames：[処理した時刻, コマの表示時刻, 撮影時刻(取れれば), 手が映っているか(1/0), 関節21点の x,y,z（0〜1）×21, 5本の指の ry, 5本の指の速さ]
 * - knocks：マイクが机の音を見つけた瞬間 { t: 推定時刻, recv: 受け取った時刻, sample: 録音の中の位置, level, bg, masked }
 * - fires ：アプリが音を鳴らした瞬間 { t, src: "mic" | "camera", mode, finger, note, step }
 * - clocks：録音のサンプル位置と時刻の対応 [時刻, サンプル位置]
 */

import { acquireMic, releaseMic, onKnock, onPcm, onClock, getMicSampleRate, syncAudioSending } from "./mic.js";

const FINGERS = ["THUMB", "INDEX", "MIDDLE", "RING", "PINKY"];

const log = {
  active: false,
  startPerf: 0,
  startDate: null,
  meta: {},
  frames: [],
  knocks: [],
  fires: [],
  clocks: [],
  pcm: [],             // Int16Array の配列
  pcmFirstSample: null,
  pcmSamples: 0,
  unsub: [],
  btn: null,
  hud: null,
  timer: null,
  getMeta: null,
  last: null           // 直近に止めた記録（書き出し用）
};

export function isDataLogging() {
  return log.active;
}

/**
 * 設定パネルに「データを集める」の行を追加する
 * @param {HTMLElement} container
 * @param {() => object} getMeta 記録開始時に保存する情報（曲・閾値・カメラ設定など）を返す関数
 * @param {() => void} onStart
 */
export function setupDataLogButton(container, getMeta, onStart) {
  log.getMeta = getMeta;
  const btn = document.createElement("button");
  btn.id = "datalog-btn";
  btn.type = "button";
  btn.className = "sp-row sp-toggle";
  btn.setAttribute("aria-pressed", "false");
  btn.innerHTML = `<span>データを集める（カメラ＋マイク）</span><span class="sp-switch" aria-hidden="true"></span>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (log.active) stopLogging();
    else {
      startLogging();
      if (onStart) onStart();
    }
  });
  container.appendChild(btn);
  log.btn = btn;
}

async function startLogging() {
  log.active = true;
  updateButton();
  showHud();
  renderHud("マイクを準備しています…");
  log.unsub.push(onPcm(onPcmBlock));
  const ok = await acquireMic("log");
  if (!ok) {
    log.unsub.forEach((u) => u());
    log.unsub = [];
    log.active = false;
    updateButton();
    renderHud("マイクを使えませんでした。ブラウザの設定でマイクを許可してから、もう一度オンにしてください。");
    return;
  }
  syncAudioSending();
  log.startPerf = performance.now();
  log.startDate = new Date();
  log.meta = { ...(log.getMeta ? log.getMeta() : {}), sampleRate: getMicSampleRate(), userAgent: navigator.userAgent, startedAt: log.startDate.toISOString(), startPerf: log.startPerf };
  log.frames = [];
  log.knocks = [];
  log.fires = [];
  log.clocks = [];
  log.pcm = [];
  log.pcmFirstSample = null;
  log.pcmSamples = 0;
  log.unsub.push(onKnock((ev) => {
    if (!log.active) return;
    log.knocks.push({ t: r1(ev.estPerf), recv: r1(ev.perf), sample: ev.f, level: r4(ev.level), bg: r4(ev.bg), masked: ev.masked });
  }));
  log.unsub.push(onClock((c) => {
    if (log.active) log.clocks.push([r1(c.perf), c.f]);
  }));
  log.timer = setInterval(() => renderHud(), 500);
  renderHud();
}

function stopLogging() {
  if (!log.active) return;
  log.active = false;
  clearInterval(log.timer);
  log.unsub.forEach((u) => u());
  log.unsub = [];
  syncAudioSending();
  releaseMic("log");
  log.last = {
    meta: { ...log.meta, stoppedAt: new Date().toISOString(), durationSec: r1((performance.now() - log.startPerf) / 1000), pcmFirstSample: log.pcmFirstSample, pcmSamples: log.pcmSamples },
    frames: log.frames,
    knocks: log.knocks,
    fires: log.fires,
    clocks: log.clocks,
    pcm: log.pcm,
    date: log.startDate
  };
  updateButton();
  renderHud();
}

function onPcmBlock(firstSample, data) {
  if (!log.active) return;
  if (log.pcmFirstSample === null) log.pcmFirstSample = firstSample;
  const out = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(-1, Math.min(1, data[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  log.pcm.push(out);
  log.pcmSamples += out.length;
}

/**
 * カメラの 1 コマを記録する
 * @param {{proc:number, pt:number, ct:number|null, hand:boolean, lm:Array<{x:number,y:number,z:number}>|null, ry:object|null, vy:object|null}} f
 */
export function logFrame(f) {
  if (!log.active) return;
  const row = [r1(f.proc), r1(f.pt), f.ct == null ? null : r1(f.ct), f.hand ? 1 : 0];
  if (f.lm) for (let i = 0; i < 21; i++) { const p = f.lm[i]; row.push(r4(p.x), r4(p.y), r4(p.z || 0)); }
  else for (let i = 0; i < 63; i++) row.push(null);
  FINGERS.forEach((k) => row.push(f.ry ? r3(f.ry[k]) : null));
  FINGERS.forEach((k) => row.push(f.vy ? r3(f.vy[k]) : null));
  log.frames.push(row);
}

/** アプリが音を鳴らしたことを記録する */
export function logFire(ev) {
  if (!log.active) return;
  log.fires.push({ ...ev, t: r1(ev.t) });
}

// ---------------------------------------------------------------------------
// 書き出し
// ---------------------------------------------------------------------------
function fileStem(date) {
  const p = (n) => String(n).padStart(2, "0");
  const d = date || new Date();
  return `piarno_log_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function saveJson() {
  const L = log.last;
  if (!L) return;
  const body = {
    format: "piarno-log-1",
    meta: L.meta,
    frameColumns: ["proc", "presentation", "capture", "hand", ...Array.from({ length: 21 }, (_, i) => [`x${i}`, `y${i}`, `z${i}`]).flat(), ...FINGERS.map((k) => `ry_${k}`), ...FINGERS.map((k) => `vy_${k}`)],
    frames: L.frames,
    knocks: L.knocks,
    fires: L.fires,
    clocks: L.clocks
  };
  download(new Blob([JSON.stringify(body)], { type: "application/json" }), `${fileStem(L.date)}.json`);
}

function saveWav() {
  const L = log.last;
  if (!L || !L.pcm.length) return;
  const sr = L.meta.sampleRate || 48000;
  const total = L.pcm.reduce((s, a) => s + a.length, 0);
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + total * 2, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, total * 2, true);
  download(new Blob([header, ...L.pcm], { type: "audio/wav" }), `${fileStem(L.date)}.wav`);
}

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------
function updateButton() {
  if (log.btn) log.btn.setAttribute("aria-pressed", String(log.active));
}

function showHud() {
  if (!log.hud) {
    const el = document.createElement("div");
    el.id = "datalog-hud";
    el.className = "latency-hud datalog-hud";
    el.setAttribute("role", "status");
    el.innerHTML = `
      <div class="lh-head"><span class="lh-title" data-v="title">データを記録中</span><button type="button" class="lh-close" data-v="stop">止める</button></div>
      <div class="lh-main"><span class="lh-value" data-v="time">0:00</span><span class="lh-sub" data-v="count"></span></div>
      <div class="dl-actions" data-v="actions" hidden>
        <button type="button" class="lh-close" data-v="json">データ（JSON）を保存</button>
        <button type="button" class="lh-close" data-v="wav">録音（WAV）を保存</button>
        <button type="button" class="lh-close" data-v="close">閉じる</button>
      </div>
      <p class="lh-msg" data-v="msg"></p>`;
    const q = (k) => el.querySelector(`[data-v="${k}"]`);
    q("stop").addEventListener("click", (e) => { e.stopPropagation(); stopLogging(); });
    q("json").addEventListener("click", (e) => { e.stopPropagation(); saveJson(); });
    q("wav").addEventListener("click", (e) => { e.stopPropagation(); saveWav(); });
    q("close").addEventListener("click", (e) => { e.stopPropagation(); el.hidden = true; });
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.body.appendChild(el);
    log.hud = el;
  }
  log.hud.hidden = false;
}

function renderHud(message) {
  if (!log.hud) return;
  const q = (k) => log.hud.querySelector(`[data-v="${k}"]`);
  const L = log.active ? log : log.last;
  const sec = log.active ? (performance.now() - log.startPerf) / 1000 : (L ? L.meta.durationSec || 0 : 0);
  q("title").textContent = log.active ? "● データを記録中" : "記録を止めました";
  q("stop").hidden = !log.active;
  q("actions").hidden = log.active || !log.last;
  q("time").textContent = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  const frames = L ? L.frames.length : 0, knocks = L ? L.knocks.length : 0, fires = L ? L.fires.length : 0;
  q("count").textContent = `カメラ ${frames} コマ・机の音 ${knocks} 回・発音 ${fires} 回`;
  const mb = L ? ((L.pcmSamples || (L.meta && L.meta.pcmSamples) || 0) * 2) / 1e6 : 0;
  q("msg").textContent = message ||
    (log.active
      ? `いつもどおり演奏してください。録音 ${mb.toFixed(1)} MB。止めると保存ボタンが出ます。`
      : "2 つのファイルを保存してください（保存したら閉じて大丈夫です）。");
}

const r1 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);
const r3 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 1000) / 1000);
const r4 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10000) / 10000);
