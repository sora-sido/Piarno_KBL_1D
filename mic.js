/**
 * マイクで机を叩いた音を見つける
 *
 * - 音の処理専用のスレッド（AudioWorklet）で 128 サンプル（48kHz で約 2.7ms）ごとに音を見張り、
 *   急に大きくなった瞬間（机を叩いた音）を見つけたらすぐ知らせる
 * - データ記録用に、マイクの録音と「マイクのサンプル位置 ↔ performance.now()」の対応も渡す
 * - アプリ自身が鳴らした音をマイクが拾ったものと見分けられるよう、音を鳴らした直後の一定時間に見つけた音には印（masked）を付ける
 */

const WORKLET_SRC = `
class KnockProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.n = 0;               // これまでのサンプル数
    this.fast = 0;            // 速い音量（時定数 1ms）
    this.slow = 0;            // ゆっくりした音量（時定数 120ms）＝周りの音の大きさ
    this.hpPrevX = 0; this.hpPrevY = 0;
    this.refractory = 0;
    this.ratio = 5;           // 周りの音の何倍になったら机の音とみなすか
    this.minLevel = 0.015;    // これより小さい音は無視
    this.sendAudio = false;
    this.buf = new Float32Array(1024); this.bufLen = 0;
    this.nextClock = 0;
    this.af = 1 - Math.exp(-1 / (sampleRate * 0.001));
    this.as = 1 - Math.exp(-1 / (sampleRate * 0.12));
    this.hpA = Math.exp(-2 * Math.PI * 60 / sampleRate); // 60Hz 以下（机の揺れ・空調の低音）を落とす
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (typeof d.ratio === "number") this.ratio = d.ratio;
      if (typeof d.minLevel === "number") this.minLevel = d.minLevel;
      if (typeof d.sendAudio === "boolean") { this.sendAudio = d.sendAudio; this.bufLen = 0; }
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const y = this.hpA * (this.hpPrevY + ch[i] - this.hpPrevX);
      this.hpPrevX = ch[i]; this.hpPrevY = y;
      const v = Math.abs(y);
      this.fast += (v - this.fast) * this.af;
      if (this.refractory > 0) {
        this.refractory--;
      } else if (this.fast > this.minLevel && this.fast > this.slow * this.ratio) {
        this.port.postMessage({ t: "on", f: this.n + i, lv: this.fast, bg: this.slow });
        this.refractory = Math.round(sampleRate * 0.06);
      }
      // 周りの音の大きさは、机の音の直後に引きずられすぎないよう速い音量より小さいときだけ素早く追う
      this.slow += (v - this.slow) * (v < this.slow ? this.as * 4 : this.as);
    }
    if (this.sendAudio) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.bufLen++] = ch[i];
        if (this.bufLen === this.buf.length) {
          this.port.postMessage({ t: "pcm", f: this.n + i + 1 - this.buf.length, d: this.buf.slice(0) });
          this.bufLen = 0;
        }
      }
    }
    this.n += ch.length;
    if (this.n >= this.nextClock) {
      this.port.postMessage({ t: "clk", f: this.n, ct: currentTime });
      this.nextClock = this.n + Math.round(sampleRate * 0.25);
    }
    return true;
  }
}
registerProcessor("knock-processor", KnockProcessor);
`;

const mic = {
  ctx: null,
  stream: null,
  node: null,
  sr: 48000,
  starting: null,
  users: new Set(),        // マイクを使っている機能（"log" など）
  knockListeners: new Set(),
  pcmListeners: new Set(),
  clockListeners: new Set(),
  lastSoundAt: -Infinity,  // アプリが最後に音を鳴らした時刻（performance.now）
  maskMs: 110,             // 音を鳴らしてからこの時間に見つけた音には印を付ける
  lastClock: null          // { f, perf } 直近の「サンプル位置 ↔ 時刻」
};

export function getMicSampleRate() {
  return mic.sr;
}

export function isMicRunning() {
  return !!mic.node;
}

/** アプリが音を鳴らしたことを知らせる（自分の音を拾ったものに印を付けるため） */
export function notifySoundPlayed() {
  mic.lastSoundAt = performance.now();
}

export function onKnock(fn) { mic.knockListeners.add(fn); return () => mic.knockListeners.delete(fn); }
export function onPcm(fn) { mic.pcmListeners.add(fn); return () => mic.pcmListeners.delete(fn); }
export function onClock(fn) { mic.clockListeners.add(fn); return () => mic.clockListeners.delete(fn); }

/**
 * マイクを使い始める（同じマイクを複数の機能で共有する）
 * @param {string} user 使う機能の名前
 */
export async function acquireMic(user) {
  mic.users.add(user);
  if (mic.node) return true;
  if (mic.starting) return mic.starting;
  mic.starting = (async () => {
    try {
      mic.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const AC = window.AudioContext || window.webkitAudioContext;
      mic.ctx = new AC({ latencyHint: "interactive" });
      if (mic.ctx.state === "suspended") await mic.ctx.resume();
      mic.sr = mic.ctx.sampleRate;
      const src = mic.ctx.createMediaStreamSource(mic.stream);
      const mute = mic.ctx.createGain();
      mute.gain.value = 0;
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
        await mic.ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        mic.node = new AudioWorkletNode(mic.ctx, "knock-processor", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        mic.node.port.onmessage = (e) => handleMessage(e.data);
      } catch (err) {
        console.warn("[MIC] AudioWorklet を使えないため ScriptProcessor で代用します:", err);
        mic.node = createScriptFallback(mic.ctx);
      }
      src.connect(mic.node);
      mic.node.connect(mute);
      mute.connect(mic.ctx.destination);
      syncAudioSending();
      return true;
    } catch (err) {
      console.warn("[MIC] マイクを使えませんでした:", err);
      mic.users.delete(user);
      releaseAll();
      return false;
    } finally {
      mic.starting = null;
    }
  })();
  return mic.starting;
}

/** マイクの使用をやめる（ほかに使っている機能がなければ止める） */
export function releaseMic(user) {
  mic.users.delete(user);
  syncAudioSending();
  if (mic.users.size === 0) releaseAll();
}

function releaseAll() {
  try { mic.node && mic.node.disconnect(); } catch {}
  try { mic.stream && mic.stream.getTracks().forEach((t) => t.stop()); } catch {}
  try { mic.ctx && mic.ctx.close(); } catch {}
  mic.node = null;
  mic.stream = null;
  mic.ctx = null;
  mic.lastClock = null;
}

/** 録音を受け取る機能があるときだけ、録音データを送ってもらう */
export function syncAudioSending() {
  const want = mic.pcmListeners.size > 0;
  if (mic.node && mic.node.port) mic.node.port.postMessage({ sendAudio: want });
  else if (mic.node) mic.node._sendAudio = want;
}

function handleMessage(d) {
  const perf = performance.now();
  if (d.t === "clk") {
    mic.lastClock = { f: d.f, perf };
    mic.clockListeners.forEach((fn) => fn({ f: d.f, perf, ct: d.ct }));
  } else if (d.t === "on") {
    // マイクのサンプル位置から、机の音が鳴った時刻（performance.now 基準）を推定する
    const estPerf = mic.lastClock ? mic.lastClock.perf + ((d.f - mic.lastClock.f) / mic.sr) * 1000 : perf;
    const masked = perf - mic.lastSoundAt < mic.maskMs;
    const ev = { perf, estPerf, f: d.f, level: d.lv, bg: d.bg, masked };
    mic.knockListeners.forEach((fn) => fn(ev));
  } else if (d.t === "pcm") {
    mic.pcmListeners.forEach((fn) => fn(d.f, d.d));
  }
}

// AudioWorklet が使えない古いブラウザ向け（処理は同じ。遅れは少し大きくなる）
function createScriptFallback(ctx) {
  const node = ctx.createScriptProcessor(256, 1, 1);
  const sr = ctx.sampleRate;
  const st = {
    n: 0, fast: 0, slow: 0, hx: 0, hy: 0, refr: 0, nextClock: 0,
    af: 1 - Math.exp(-1 / (sr * 0.001)), as: 1 - Math.exp(-1 / (sr * 0.12)), hpA: Math.exp(-2 * Math.PI * 60 / sr)
  };
  node.onaudioprocess = (e) => {
    const ch = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      const y = st.hpA * (st.hy + ch[i] - st.hx);
      st.hx = ch[i]; st.hy = y;
      const v = Math.abs(y);
      st.fast += (v - st.fast) * st.af;
      if (st.refr > 0) st.refr--;
      else if (st.fast > 0.015 && st.fast > st.slow * 5) {
        handleMessage({ t: "on", f: st.n + i, lv: st.fast, bg: st.slow });
        st.refr = Math.round(sr * 0.06);
      }
      st.slow += (v - st.slow) * (v < st.slow ? st.as * 4 : st.as);
    }
    if (node._sendAudio) handleMessage({ t: "pcm", f: st.n, d: ch.slice(0) });
    st.n += ch.length;
    if (st.n >= st.nextClock) {
      handleMessage({ t: "clk", f: st.n, ct: ctx.currentTime });
      st.nextClock = st.n + Math.round(sr * 0.25);
    }
  };
  return node;
}
