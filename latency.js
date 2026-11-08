/**
 * 遅れの測定モード
 *
 * 机を叩いた音と、アプリが鳴らした音を同じマイクで聞き、その時間差を測る。
 * 同じマイクで両方を聞くので、マイク自体の遅れは打ち消され、
 * 「指が机に当たってから、スピーカー（イヤホン）から音が出るまで」の全体の遅れが分かる。
 *
 * - 測定中はピアノの代わりに 3kHz の短い測定音を鳴らす（机の音と聞き分けやすくするため）
 * - 測定音の始まり：3kHz の成分がほとんどを占めるようになった最初の位置
 * - 机の音の始まり：測定音を取り除いた（1.2kHz 以下だけ残した）音で、いちばん大きな立ち上がりの始まり
 */

const BEEP_FREQ = 3000;     // 測定音の高さ（Hz）
const BEEP_SEC = 0.06;      // 測定音の長さ（秒）
const RING_SEC = 4;         // マイク音を取っておく長さ（秒）
const SEARCH_AFTER = 0.8;   // 判定のあと、測定音を探す範囲（秒）
const KNOCK_BEFORE = 0.5;   // 測定音の何秒前まで机の音を探すか
const KNOCK_AFTER = 0.15;   // 測定音の何秒後まで机の音を探すか（音が先に出た場合）

const lat = {
  on: false,
  ctx: null,          // マイク解析用の AudioContext
  stream: null,
  node: null,
  ring: null,
  count: 0,           // これまでに受け取ったマイクのサンプル数
  sr: 48000,
  pending: [],        // 解析待ちの打鍵 { pos }
  results: [],        // 測れた遅れ（ms）
  misses: 0,          // 机の音か測定音が見つからなかった回数
  getAudioContext: null,
  btn: null,
  hud: null
};

export function isLatencyMode() {
  return lat.on;
}

/**
 * 設定パネルに「遅れを測る」の行を追加する
 * @param {HTMLElement} container
 * @param {() => AudioContext} getAudioContext 発音に使っている AudioContext を返す関数
 * @param {() => void} onStart 測定を始めたときに呼ぶ（設定パネルを閉じるなど）
 */
export function setupLatencyButton(container, getAudioContext, onStart) {
  lat.getAudioContext = getAudioContext;
  const btn = document.createElement("button");
  btn.id = "latency-btn";
  btn.type = "button";
  btn.className = "sp-row sp-toggle";
  btn.setAttribute("aria-pressed", "false");
  btn.innerHTML = `<span>遅れを測る（マイクを使う）</span><span class="sp-switch" aria-hidden="true"></span>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (lat.on) stopLatency();
    else {
      startLatency();
      if (onStart) onStart();
    }
  });
  container.appendChild(btn);
  lat.btn = btn;
}

async function startLatency() {
  lat.on = true;
  lat.results = [];
  lat.misses = 0;
  lat.pending = [];
  updateButton();
  showHud();
  renderHud("マイクを準備しています…");
  try {
    // エコー除去・雑音除去・音量の自動調整が入ると、測定音や机の音が消されてしまうので切る
    lat.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    lat.ctx = new AC();
    if (lat.ctx.state === "suspended") await lat.ctx.resume();
    lat.sr = lat.ctx.sampleRate;
    lat.ring = new Float32Array(Math.round(lat.sr * RING_SEC));
    lat.count = 0;
    const src = lat.ctx.createMediaStreamSource(lat.stream);
    const node = lat.ctx.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = onAudio;
    const mute = lat.ctx.createGain();
    mute.gain.value = 0; // onaudioprocess を動かすために出力へつなぐが、音は出さない
    src.connect(node);
    node.connect(mute);
    mute.connect(lat.ctx.destination);
    lat.node = node;
    renderHud();
  } catch (err) {
    console.warn("[LATENCY] マイクを使えませんでした:", err);
    renderHud("マイクを使えませんでした。ブラウザの設定でマイクを許可してから、もう一度オンにしてください。");
    lat.on = false;
    updateButton();
    cleanupMic();
  }
}

function stopLatency() {
  lat.on = false;
  updateButton();
  cleanupMic();
  if (lat.hud) lat.hud.hidden = true;
}

function cleanupMic() {
  try { lat.node && lat.node.disconnect(); } catch {}
  try { lat.stream && lat.stream.getTracks().forEach((t) => t.stop()); } catch {}
  try { lat.ctx && lat.ctx.close(); } catch {}
  lat.node = null;
  lat.stream = null;
  lat.ctx = null;
}

function onAudio(e) {
  const input = e.inputBuffer.getChannelData(0);
  const ring = lat.ring;
  const n = ring.length;
  for (let i = 0; i < input.length; i++) {
    ring[(lat.count + i) % n] = input[i];
  }
  lat.count += input.length;

  // 測定音を探す範囲のマイク音がそろった打鍵から解析する
  while (lat.pending.length && lat.count >= lat.pending[0].pos + Math.round(lat.sr * (SEARCH_AFTER + KNOCK_AFTER + 0.05))) {
    analyzeTap(lat.pending.shift());
  }
}

/**
 * 打鍵の判定が出たときに呼ぶ（ピアノの代わりに測定音を鳴らし、解析を予約する）
 */
export function onLatencyTap() {
  playBeep();
  if (!lat.ctx || !lat.ring) return;
  // 前の打鍵の解析が終わっていないうちに叩くと、測定音を取り違えるので数えない
  if (lat.pending.length) {
    lat.misses++;
    renderHud();
    return;
  }
  lat.pending.push({ pos: lat.count });
}

function playBeep() {
  const ctx = lat.getAudioContext ? lat.getAudioContext() : null;
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(BEEP_FREQ, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.8, now + 0.002);
    g.gain.setValueAtTime(0.8, now + BEEP_SEC - 0.01);
    g.gain.linearRampToValueAtTime(0.0001, now + BEEP_SEC);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + BEEP_SEC + 0.02);
  } catch (err) {
    console.warn("[LATENCY] 測定音を鳴らせませんでした:", err);
  }
}

function analyzeTap({ pos }) {
  const sr = lat.sr;
  const start = Math.max(0, pos - Math.round(sr * 0.6), lat.count - lat.ring.length);
  const end = lat.count;
  const buf = new Float32Array(end - start);
  for (let i = 0; i < buf.length; i++) buf[i] = lat.ring[(start + i) % lat.ring.length];
  const r = analyzeWindow(buf, sr, pos - start, BEEP_FREQ);
  if (r.ok) {
    lat.results.push(r.latencyMs);
    console.log(`[LATENCY] 机の音 → 測定音: ${r.latencyMs.toFixed(0)} ms`);
  } else {
    lat.misses++;
    console.log(`[LATENCY] 測れませんでした: ${r.reason}`);
  }
  renderHud(r.ok ? null : r.reason);
}

/**
 * マイク音の一部から、机の音と測定音の始まりを探す（画面やマイクに依存しない純粋な関数）
 * @param {Float32Array} x マイク音
 * @param {number} sr サンプリング周波数
 * @param {number} trigIdx 判定が出た時点のサンプル位置（x の中での位置）
 * @param {number} freq 測定音の高さ（Hz）
 * @returns {{ok: boolean, latencyMs?: number, knockIdx?: number, beepIdx?: number, reason?: string}}
 */
export function analyzeWindow(x, sr, trigIdx, freq = BEEP_FREQ) {
  // --- 測定音の始まり：4ms の窓を 1ms ずつずらし、3kHz の成分の割合と大きさを見る ---
  const win = Math.round(sr * 0.004);
  const hop = Math.round(sr * 0.001);
  const w = (2 * Math.PI * freq) / sr;
  const coeff = 2 * Math.cos(w);
  // 割合を出すときの「全体の強さ」は 2kHz 以上だけで測る（机の音の低い成分で割合が下がらないように）
  const hp = zeroPhase(x, sr, 2000, "high");
  const toneAt = (s) => {
    let s1 = 0, s2 = 0, energy = 0;
    for (let i = 0; i < win; i++) {
      const v = x[s + i];
      const s0 = v + coeff * s1 - s2;
      s2 = s1; s1 = s0;
      energy += hp[s + i] * hp[s + i];
    }
    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2; // その周波数の成分の強さ
    const ratio = energy > 0 ? (2 * power) / (win * energy) : 0;
    return { ratio, rms: Math.sqrt(energy / win) };
  };
  // 雑音の大きさ：判定前 0.3 秒の音の大きさの中央値
  const noiseRms = [];
  for (let s = Math.max(0, trigIdx - Math.round(sr * 0.3)); s + win < trigIdx; s += hop) noiseRms.push(toneAt(s).rms);
  noiseRms.sort((a, b) => a - b);
  const floor = noiseRms.length ? noiseRms[noiseRms.length >> 1] : 0;

  let beepIdx = -1, run = 0;
  const beepEnd = Math.min(x.length - win, trigIdx + Math.round(sr * SEARCH_AFTER));
  for (let s = Math.max(0, trigIdx); s < beepEnd; s += hop) {
    const { ratio, rms } = toneAt(s);
    if (ratio > 0.6 && rms > Math.max(floor * 4, 0.002)) {
      run++;
      if (run === 3) { beepIdx = s - 2 * hop; break; }
    } else run = 0;
  }
  if (beepIdx < 0) return { ok: false, reason: "測定音が聞こえませんでした（音量を上げてください）" };
  // 窓の中に測定音が入り始めた位置まで戻す（窓の半分ぶん手前に始まりがある）
  beepIdx = Math.max(0, beepIdx + Math.round(win / 2) - hop);

  // --- 机の音の始まり：測定音を取り除いた音（1kHz 以下）の立ち上がり ---
  const lp = zeroPhase(x, sr, 1000, "low");
  const frame = Math.round(sr * 0.001);
  const env = [];
  for (let s = 0; s + frame <= lp.length; s += frame) {
    let m = 0;
    for (let i = s; i < s + frame; i++) m = Math.max(m, Math.abs(lp[i]));
    env.push(m);
  }
  const f0 = Math.max(0, Math.floor((beepIdx - sr * KNOCK_BEFORE) / frame));
  const f1 = Math.min(env.length - 1, Math.floor((beepIdx + sr * KNOCK_AFTER) / frame));
  const sorted = env.slice(Math.max(0, f0 - 300), f1).sort((a, b) => a - b);
  const envFloor = sorted.length ? sorted[Math.floor(sorted.length * 0.3)] : 0;
  let pk = -1, P = 0;
  for (let f = f0; f <= f1; f++) if (env[f] > P) { P = env[f]; pk = f; }
  if (pk < 0 || P < Math.max(envFloor * 5, 0.004)) {
    return { ok: false, reason: "机を叩いた音が聞こえませんでした（もう少し強く叩いてください）" };
  }
  let on = pk;
  while (on > f0 && env[on - 1] >= P * 0.25) on--;
  const knockIdx = on * frame;

  return { ok: true, knockIdx, beepIdx, latencyMs: ((beepIdx - knockIdx) / sr) * 1000 };
}

// 2次のフィルタ（RBJ のバイカッド）。type は "low"（ローパス）か "high"（ハイパス）
function biquad(x, sr, fc, type) {
  const w0 = (2 * Math.PI * fc) / sr, q = Math.SQRT1_2;
  const alpha = Math.sin(w0) / (2 * q), cw = Math.cos(w0);
  const a0 = 1 + alpha;
  const k = type === "high" ? (1 + cw) / 2 : (1 - cw) / 2;
  const b0 = k / a0, b1 = (type === "high" ? -2 * k : 2 * k) / a0, b2 = k / a0;
  const a1 = (-2 * cw) / a0, a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// 前向きと後ろ向きに 2 回ずつかけ、時間のずれをなくしたうえで減衰を強くする
function zeroPhase(x, sr, fc, type) {
  let y = biquad(biquad(x, sr, fc, type), sr, fc, type);
  y.reverse();
  y = biquad(biquad(y, sr, fc, type), sr, fc, type);
  return y.reverse();
}

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------
function updateButton() {
  if (lat.btn) lat.btn.setAttribute("aria-pressed", String(lat.on));
}

function showHud() {
  if (!lat.hud) {
    const el = document.createElement("div");
    el.id = "latency-hud";
    el.className = "latency-hud";
    el.setAttribute("role", "status");
    el.innerHTML = `
      <div class="lh-head"><span class="lh-title">遅れの測定</span><button type="button" class="lh-close" aria-label="測定を終える">終える</button></div>
      <div class="lh-main"><span class="lh-label">中央値</span><span class="lh-value" data-v="median">—</span><span class="lh-sub" data-v="count"></span></div>
      <div class="lh-list" data-v="list"></div>
      <p class="lh-msg" data-v="msg"></p>`;
    el.querySelector(".lh-close").addEventListener("click", (e) => {
      e.stopPropagation();
      stopLatency();
    });
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.body.appendChild(el);
    lat.hud = el;
  }
  lat.hud.hidden = false;
}

function renderHud(message) {
  if (!lat.hud) return;
  const q = (k) => lat.hud.querySelector(`[data-v="${k}"]`);
  const r = lat.results;
  const sorted = r.slice().sort((a, b) => a - b);
  const fmt = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))} ms`;
  q("median").textContent = sorted.length ? fmt(sorted[sorted.length >> 1]) : "—";
  q("count").textContent = `${r.length} 回測定${lat.misses ? `・${lat.misses} 回測れず` : ""}`;
  q("list").innerHTML = r.slice(-8).reverse().map((v, i) => `<span class="${i === 0 ? "latest" : ""}">${fmt(v)}</span>`).join("");
  q("msg").textContent = message ||
    (r.length
      ? "＋は音が机の音より遅れている、−は早いという意味です。"
      : "1 秒に 1 回くらいの間隔で、机をはっきり叩いてください。ピアノの代わりに「ピッ」という測定音が鳴ります。");
}
