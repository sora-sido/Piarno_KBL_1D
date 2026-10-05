/**
 * MediaPipe Hand Landmarker 最小検証環境 (インカメラ・鏡像完全一致)
 * 
 * 机面スレスレの水平アングルから手を認識させる前提の最小実装。
 * 遅延検証のため、平滑化フィルター（移動平均や1 Euro Filter等）は一切挟まず、
 * 検出された生（Raw）のランドマーク座標をダイレクトにCanvasへ描画します。
 */

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import * as Tone from "tone";

// DOM要素
const video = document.getElementById("webcam");
const canvas = document.getElementById("output-canvas");
const canvasCtx = canvas.getContext("2d");
const statusText = document.getElementById("status-text");
const fpsCounter = document.getElementById("fps-counter");
const inferenceTime = document.getElementById("inference-time");
const handsCount = document.getElementById("hands-count");
const camInfo = document.getElementById("cam-info");
const errorBox = document.getElementById("error-box");
const cameraErrorOverlay = document.getElementById("camera-error-overlay");
const cameraErrorTitle = document.getElementById("camera-error-title");
const cameraErrorMessage = document.getElementById("camera-error-message");
const cameraErrorReloadBtn = document.getElementById("camera-error-reload-btn");
const cameraErrorCloseBtn = document.getElementById("camera-error-close-btn");
const cameraTapPrompt = document.getElementById("camera-tap-prompt");
const cameraTapBtn = document.getElementById("camera-tap-btn");
const audioStartBanner = document.getElementById("audio-start-banner");
const startModal = document.getElementById("start-modal");
const startPlayBtn = document.getElementById("start-play-btn");
const startPlayText = document.getElementById("start-play-text");
const inappBrowserModal = document.getElementById("inapp-browser-modal");
const inappBrowserBadge = document.getElementById("inapp-browser-badge");
const inappBrowserDesc = document.getElementById("inapp-browser-desc");
const inappOpenExternalBtn = document.getElementById("inapp-open-external-btn");
const inappCopyUrlBtn = document.getElementById("inapp-copy-url-btn");
const inappContinueBtn = document.getElementById("inapp-continue-btn");
const inappCopyToast = document.getElementById("inapp-copy-toast");
const tipXVal = document.getElementById("tip-x-val");
const tipYVal = document.getElementById("tip-y-val");
const relYVal = document.getElementById("rel-y-val");
const thVal = document.getElementById("th-val");
const stateVal = document.getElementById("state-val");
const tapCountVal = document.getElementById("tap-count-val");
const csvStatus = document.getElementById("csv-status");
const csvFileInput = document.getElementById("csv-file-input");
const testSoundBtn = document.getElementById("test-sound-btn");
const targetFingerVal = document.getElementById("target-finger-val");
const targetTapProgress = document.getElementById("target-tap-progress");
const songProgressBadge = document.getElementById("song-progress-badge");
const debugPanel = document.getElementById("debug-panel");

// デバッグHUDの表示状態フラグ（非表示時は毎フレームのDOM書き込み・文字列演算をスキップ）
let isDebugPanelVisible = false;
function checkDebugPanelVisibility() {
  if (!debugPanel) {
    isDebugPanelVisible = false;
    return;
  }
  isDebugPanelVisible = window.getComputedStyle(debugPanel).display !== "none";
}
checkDebugPanelVisibility();
window.addEventListener("resize", checkDebugPanelVisibility);

// テスト用CSVデータセット群（ファイル別）
export let testDataDatasets = [];
// 全ファイルのフレームを結合したフラット配列
export let testDataFrames = [];

// Web Audio API サウンドエンジン ＆ Tone.js Salamander Grand Piano
let audioCtx = null;
let tapCount = 0;
let pianoSampler = null;
let isSamplerLoaded = false;

// 周波数（Hz）からノート名への高精度マッピング（自然な中央オクターブ C4〜G4 を右手メロディ、低音 C3〜G3 を自動伴奏に設定）
const FREQ_TO_NOTE_MAP = {
  // 自動低音伴奏域（C3〜G3）
  130.81: "C3",
  146.83: "D3",
  164.81: "E3",
  174.61: "F3",
  196.00: "G3",
  // 右手メロディ中央域（C4〜G4）
  261.63: "C4",
  293.66: "D4",
  329.63: "E4",
  349.23: "F4",
  392.00: "G4",
  // （互換用高音域 C5〜G5）
  523.25: "C5",
  587.33: "D5",
  659.25: "E5",
  698.46: "F5",
  783.99: "G5"
};

// ノート名から周波数（Hz）への逆引きマッピング（フォールバック合成時にも使用）
const NOTE_TO_FREQ_MAP = Object.entries(FREQ_TO_NOTE_MAP).reduce((acc, [f, n]) => {
  acc[n] = parseFloat(f);
  return acc;
}, {});

// 任意の音名（"F#4", "B2" 等）を平均律の周波数へ変換（伴奏和音のフォールバック合成用）
function noteNameToFreq(noteName) {
  const m = /^([A-G])(#?)(\d)$/.exec(noteName);
  if (!m) return null;
  const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0);
  const midi = semis + 12 * (parseInt(m[3], 10) + 1);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Tone.js Salamander Grand Piano 音源サンプラーの初期化
 */
function initPianoSampler() {
  try {
    pianoSampler = new Tone.Sampler({
      urls: {
        A0: "A0.mp3",
        C1: "C1.mp3",
        "D#1": "Ds1.mp3",
        "F#1": "Fs1.mp3",
        A1: "A1.mp3",
        C2: "C2.mp3",
        "D#2": "Ds2.mp3",
        "F#2": "Fs2.mp3",
        A2: "A2.mp3",
        C3: "C3.mp3",
        "D#3": "Ds3.mp3",
        "F#3": "Fs3.mp3",
        A3: "A3.mp3",
        C4: "C4.mp3",
        "D#4": "Ds4.mp3",
        "F#4": "Fs4.mp3",
        A4: "A4.mp3",
        C5: "C5.mp3",
        "D#5": "Ds5.mp3",
        "F#5": "Fs5.mp3",
        A5: "A5.mp3",
        C6: "C6.mp3",
        "D#6": "Ds6.mp3",
        "F#6": "Fs6.mp3",
        A6: "A6.mp3",
        C7: "C7.mp3",
        "D#7": "Ds7.mp3",
        "F#7": "Fs7.mp3",
        A7: "A7.mp3",
        C8: "C8.mp3"
      },
      // 同音連打（ミ・ミ、ド・ド等）時に音が不自然にチョップされず、自然なピアノの減衰・オーバーラップが持続するようリリースを拡張
      release: 2.4,
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      onload: () => {
        isSamplerLoaded = true;
        console.log("[AUDIO] Salamander Grand Piano サンプル音源のロードが完了しました");
      }
    }).toDestination();
  } catch (err) {
    console.warn("[AUDIO] Tone.Sampler 初期化エラー:", err);
  }
}

// サンプラーの初期化を実行
initPianoSampler();

// 学習済みCSVから自動導出される閾値モデル（デフォルト値付き）
let hitRyThreshold = 0.70;
let liftRyThreshold = 0.45;
let trainedHitSamples = 0;

// 打鍵ステートマシン管理（IDLE: 待機, TOUCHED: 机面接触中・リフト待ち）
let tapState = "IDLE";

/**
 * AudioContextの初期化・再開（ブラウザのAutoplay Policy対応）
 */
export function ensureAudioContext() {
  if (Tone.context.state !== "running") {
    Tone.start().catch((err) => {
      console.warn("[AUDIO] Tone.start エラー:", err);
    });
  }

  const rawCtx = Tone.getContext().rawContext;
  if (rawCtx && rawCtx.state === "suspended") {
    rawCtx.resume().catch((err) => {
      console.warn("[AUDIO] AudioContext resume failed:", err);
    });
  }

  // 初回サウンド有効化バナーがあれば非表示にする
  const banner = document.getElementById("audio-start-banner");
  if (banner && !banner.classList.contains("hidden")) {
    banner.classList.add("hidden");
  }

  return rawCtx;
}

/**
 * サンプルロード前やエラー時のオシレーター波形合成フォールバック（Web Audio API 加算合成）
 * @param {number} freq 周波数 (Hz)
 */
function playSynthFallback(freq = 523.25, velocity = 1) {
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();

  const oscBase = ctx.createOscillator();
  const gainBase = ctx.createGain();
  oscBase.type = "triangle";
  oscBase.frequency.setValueAtTime(freq, now);
  gainBase.gain.setValueAtTime(0.40, now);
  oscBase.connect(gainBase);
  gainBase.connect(masterGain);

  const oscHarmonic = ctx.createOscillator();
  const gainHarmonic = ctx.createGain();
  oscHarmonic.type = "sine";
  oscHarmonic.frequency.setValueAtTime(freq * 2, now);
  gainHarmonic.gain.setValueAtTime(0.20, now);
  oscHarmonic.connect(gainHarmonic);
  gainHarmonic.connect(masterGain);

  masterGain.gain.setValueAtTime(0.001, now);
  masterGain.gain.linearRampToValueAtTime(0.65 * velocity, now + 0.003);
  // 同音連打時にも音が急峻に切れず自然な余韻が重なるよう減衰時間を延長（0.26s -> 0.55s）
  masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

  masterGain.connect(ctx.destination);

  oscBase.start(now);
  oscHarmonic.start(now);
  oscBase.stop(now + 0.56);
  oscHarmonic.stop(now + 0.56);
}

/**
 * Salamander Grand Piano実機サンプリング音源によるリアルなピアノ発音
 * @param {number|string} targetFreqOrNote 周波数 (Hz) または 音名 ("C5", "D5" 等)
 * @param {boolean} countAsTap 打鍵回数としてカウントするかどうか（自動伴奏等はfalse）
 * @param {number} velocity 音量（0〜1）。伴奏はメロディより小さく鳴らす
 */
export function playTapSound(targetFreqOrNote = 523.25, countAsTap = true, velocity = 1) {
  ensureAudioContext();

  let noteName = null;
  let freq = 523.25;

  if (typeof targetFreqOrNote === "string") {
    noteName = targetFreqOrNote;
    freq = NOTE_TO_FREQ_MAP[noteName] || noteNameToFreq(noteName) || 523.25;
  } else if (typeof targetFreqOrNote === "number") {
    freq = targetFreqOrNote;
    const roundedFreq = Math.round(freq * 100) / 100;
    noteName = FREQ_TO_NOTE_MAP[roundedFreq] || freq;
  }

  if (isSamplerLoaded && pianoSampler) {
    try {
      // 2分音符相当の自然な減衰でリアルなピアノを発音
      pianoSampler.triggerAttackRelease(noteName, "2n", undefined, velocity);
    } catch (e) {
      console.warn("[AUDIO] Sampler 発音エラー、フォールバック合成を使用:", e);
      playSynthFallback(freq, velocity);
    }
  } else {
    // サンプル音源ロード完了前はフォールバック合成
    playSynthFallback(freq, velocity);
  }

  if (countAsTap) {
    tapCount++;
    if (tapCountVal) {
      tapCountVal.textContent = `${tapCount}`;
    }
  }
}

// 状態管理
let handLandmarker = null;
let currentStream = null;
let isPredicting = false;
let lastVideoTime = -1;
let lastFpsUpdateTime = performance.now();
let frameCount = 0;

// 人差し指先端（TIP）の最新生ピクセル座標
export const currentTip = {
  x: 0,
  y: 0
};

/**
 * 1 Euro Filter（ワンユーロフィルター）
 * 低速時はジッター（微小な震え）を完全に平滑化し、高速打鍵時は遅延ゼロで追従する標準適応フィルター
 */
class OneEuroFilter {
  constructor(minCutoff = 1.2, beta = 0.008, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  reset(x = null, timestamp = null) {
    this.xPrev = x;
    this.dxPrev = 0;
    this.tPrev = timestamp;
  }

  alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x, timestamp = performance.now()) {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = timestamp;
      return x;
    }

    const dt = Math.max((timestamp - this.tPrev) / 1000, 0.001);
    this.tPrev = timestamp;

    // 速度（1階差分）の平滑化
    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;

    // 速度に応じた動的カットオフ周波数（素早い動きでは自動で高くなり遅延ゼロ）
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);

    // 信号の平滑化
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;

    return xHat;
  }
}

/**
 * 2D関節座標用 1 Euro Filter
 */
class PointFilter {
  constructor(minCutoff = 1.2, beta = 0.008) {
    this.xf = new OneEuroFilter(minCutoff, beta);
    this.yf = new OneEuroFilter(minCutoff, beta);
  }

  reset(x = null, y = null, timestamp = null) {
    this.xf.reset(x, timestamp);
    this.yf.reset(y, timestamp);
  }

  /**
   * 過去座標からの引きずりをバイパスし、指定座標で即座にスナップ初期化
   * @param {number} x
   * @param {number} y
   * @param {number} timestamp
   * @param {object} out
   */
  snap(x, y, timestamp, out = null) {
    this.reset(x, y, timestamp);
    if (out) {
      out.x = x;
      out.y = y;
      return out;
    }
    return {
      x,
      y
    };
  }

  filter(x, y, timestamp, out = null) {
    const fx = this.xf.filter(x, timestamp);
    const fy = this.yf.filter(y, timestamp);
    if (out) {
      out.x = fx;
      out.y = fy;
      return out;
    }
    return {
      x: fx,
      y: fy
    };
  }
}

// 日本語指名マッピング（本システムは右手のみでの演奏を前提）
export const FINGER_NAMES = {
  THUMB: "親指",
  INDEX: "人差し指",
  MIDDLE: "中指",
  RING: "薬指",
  PINKY: "小指"
};

// 対象指の定義（右手 親指〜小指までの全指・ハ長調基本ポジション C5〜G5）
export const FINGER_CONFIGS = {
  THUMB: {
    fingerNum: 1,
    key: "THUMB",
    hand: "右手",
    shortName: "親指",
    label: "右手 親指 (1: ド)",
    freq: 523.25, // C5 (ド)
    baseIdx: 2,   // MCP (付け根)
    p1Idx: 1,     // CMC
    p2Idx: 2,     // MCP
    p3Idx: 3,     // IP
    tipIdx: 4,    // TIP
    indices: [1, 2, 3, 4]
  },
  INDEX: {
    fingerNum: 2,
    key: "INDEX",
    hand: "右手",
    shortName: "人差し指",
    label: "右手 人差し指 (2: レ)",
    freq: 587.33, // D5 (レ)
    baseIdx: 5,   // MCP
    p1Idx: 5,     // MCP
    p2Idx: 6,     // PIP
    p3Idx: 7,     // DIP
    tipIdx: 8,    // TIP
    indices: [5, 6, 7, 8]
  },
  MIDDLE: {
    fingerNum: 3,
    key: "MIDDLE",
    hand: "右手",
    shortName: "中指",
    label: "右手 中指 (3: ミ)",
    freq: 659.25, // E5 (ミ)
    baseIdx: 9,   // MCP
    p1Idx: 9,     // MCP
    p2Idx: 10,    // PIP
    p3Idx: 11,    // DIP
    tipIdx: 12,   // TIP
    indices: [9, 10, 11, 12]
  },
  RING: {
    fingerNum: 4,
    key: "RING",
    hand: "右手",
    shortName: "薬指",
    label: "右手 薬指 (4: ファ)",
    freq: 698.46, // F5 (ファ)
    baseIdx: 13,  // MCP
    p1Idx: 13,    // MCP
    p2Idx: 14,    // PIP
    p3Idx: 15,    // DIP
    tipIdx: 16,   // TIP
    indices: [13, 14, 15, 16]
  },
  PINKY: {
    fingerNum: 5,
    key: "PINKY",
    hand: "右手",
    shortName: "小指",
    label: "右手 小指 (5: ソ)",
    freq: 783.99, // G5 (ソ)
    baseIdx: 17,  // MCP
    p1Idx: 17,    // MCP
    p2Idx: 18,    // PIP
    p3Idx: 19,    // DIP
    tipIdx: 20,   // TIP
    indices: [17, 18, 19, 20]
  }
};

// 『よろこびのうた（Ode to Joy）』運指・音名シーケンス定義（右手5音固定 C5〜G5・全16小節/62音）
// 伴奏は pianojuku.info「第九 歓喜の歌」の両手アレンジに準拠（右手の和音の下声部＋左手パート）
// ※演奏者は右手のみを使用します（和音・左手パートはすべてアプリ側の自動伴奏音です）
// beats: 次の打鍵までの拍数（4分音符=1）
// autoChord: 打鍵と同時に鳴らす伴奏音 / autoOffbeat: 打鍵から beat 拍後に鳴らす伴奏音（裏拍の左手など）
// 小節12の「ソ」は原曲どおり低いソ（G4）を鳴らします（運指は小指のまま）
// 1:親指(C5/ド), 2:人差し指(D5/レ), 3:中指(E5/ミ★第1音), 4:薬指(F5/ファ), 5:小指(G5/ソ)
export const ODE_TO_JOY_SEQUENCE = [
  // ==========================================
  // 第1節（フレーズ1）: ミ ミ ファ ソ ｜ ソ ファ ミ レ ｜ ド ド レ ミ ｜ ミ レ レ ─
  // ==========================================
  // 小節1: ミ ミ ファ ソ - 伴奏コード: C
  { step: 1,  phrase: 1, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["C3", "C4", "C5"], autoOffbeat: [] },
  { step: 2,  phrase: 1, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["C5"], autoOffbeat: [{ beat: 0.5, notes: ["C3", "C4"] }] },
  { step: 3,  phrase: 1, fingerNum: 4, fingerKey: "RING",   note: "ファ",  rightNote: "F5", freq: 698.46, beats: 1, autoChord: ["E3", "C4", "D5"], autoOffbeat: [] },
  { step: 4,  phrase: 1, fingerNum: 5, fingerKey: "PINKY",  note: "ソ",   rightNote: "G5", freq: 783.99, beats: 1, autoChord: ["G3", "E5"], autoOffbeat: [] },
  // 小節2: ソ ファ ミ レ - 伴奏コード: G
  { step: 5,  phrase: 1, fingerNum: 5, fingerKey: "PINKY",  note: "ソ",   rightNote: "G5", freq: 783.99, beats: 1, autoChord: ["G2", "G3", "E5"], autoOffbeat: [] },
  { step: 6,  phrase: 1, fingerNum: 4, fingerKey: "RING",   note: "ファ",  rightNote: "F5", freq: 698.46, beats: 1, autoChord: ["D5"], autoOffbeat: [{ beat: 0.5, notes: ["G2", "G3"] }] },
  { step: 7,  phrase: 1, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["B2", "G3", "C5"], autoOffbeat: [] },
  { step: 8,  phrase: 1, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1, autoChord: ["D3", "G4"], autoOffbeat: [] },
  // 小節3: ド ド レ ミ - 伴奏コード: C
  { step: 9,  phrase: 1, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 1, autoChord: ["C3", "G3", "E4", "G4"], autoOffbeat: [] },
  { step: 10, phrase: 1, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 1, autoChord: ["E4"], autoOffbeat: [{ beat: 0.5, notes: ["C3", "G3"] }] },
  { step: 11, phrase: 1, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1, autoChord: ["E3", "G3", "G4"], autoOffbeat: [] },
  { step: 12, phrase: 1, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["G2", "E4", "G4", "C5"], autoOffbeat: [] },
  // 小節4: ミ レ レ ─ - 伴奏コード: C→G
  { step: 13, phrase: 1, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1.5, autoChord: ["C3", "G4", "C5"], autoOffbeat: [{ beat: 0.5, notes: ["C4"] }, { beat: 1, notes: ["G3"] }] },
  { step: 14, phrase: 1, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 0.5, autoChord: ["E3", "B4"], autoOffbeat: [] },
  { step: 15, phrase: 1, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 2, autoChord: ["B2", "D4", "G4", "B4"], autoOffbeat: [{ beat: 1, notes: ["G3"] }] },

  // ==========================================
  // 第2節（フレーズ2）: ミ ミ ファ ソ ｜ ソ ファ ミ レ ｜ ド ド レ ミ ｜ レ ド ド ─
  // ==========================================
  // 小節5: ミ ミ ファ ソ - 伴奏コード: C
  { step: 16, phrase: 2, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["C3", "C4", "C5"], autoOffbeat: [] },
  { step: 17, phrase: 2, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["C5"], autoOffbeat: [{ beat: 0.5, notes: ["C3", "C4"] }] },
  { step: 18, phrase: 2, fingerNum: 4, fingerKey: "RING",   note: "ファ",  rightNote: "F5", freq: 698.46, beats: 1, autoChord: ["E3", "C4", "D5"], autoOffbeat: [] },
  { step: 19, phrase: 2, fingerNum: 5, fingerKey: "PINKY",  note: "ソ",   rightNote: "G5", freq: 783.99, beats: 1, autoChord: ["G3", "E5"], autoOffbeat: [] },
  // 小節6: ソ ファ ミ レ - 伴奏コード: G
  { step: 20, phrase: 2, fingerNum: 5, fingerKey: "PINKY",  note: "ソ",   rightNote: "G5", freq: 783.99, beats: 1, autoChord: ["G2", "G3", "E5"], autoOffbeat: [] },
  { step: 21, phrase: 2, fingerNum: 4, fingerKey: "RING",   note: "ファ",  rightNote: "F5", freq: 698.46, beats: 1, autoChord: ["D5"], autoOffbeat: [{ beat: 0.5, notes: ["G2", "G3"] }] },
  { step: 22, phrase: 2, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["B2", "G3", "C5"], autoOffbeat: [] },
  { step: 23, phrase: 2, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1, autoChord: ["D3", "G4"], autoOffbeat: [] },
  // 小節7: ド ド レ ミ - 伴奏コード: C
  { step: 24, phrase: 2, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 1, autoChord: ["C3", "G3", "E4", "G4"], autoOffbeat: [] },
  { step: 25, phrase: 2, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 1, autoChord: ["E4"], autoOffbeat: [{ beat: 0.5, notes: ["C3", "G3"] }] },
  { step: 26, phrase: 2, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1, autoChord: ["E3", "G3", "G4"], autoOffbeat: [] },
  { step: 27, phrase: 2, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["G2", "E4", "G4", "C5"], autoOffbeat: [] },
  // 小節8: レ ド ド ─ - 伴奏コード: G→C
  { step: 28, phrase: 2, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1.5, autoChord: ["B2", "D3", "G3", "D4", "G4", "B4"], autoOffbeat: [] },
  { step: 29, phrase: 2, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 0.5, autoChord: ["E4"], autoOffbeat: [] },
  { step: 30, phrase: 2, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 2, autoChord: ["G3", "E4", "G4"], autoOffbeat: [{ beat: 1, notes: ["C3"] }] },

  // ==========================================
  // 第3節（フレーズ3）: レ レ ミ ド ｜ レ ミ(短) ファ(短) ミ ド ｜ レ ミ(短) ファ(短) ミ レ ｜ ド レ ソ ─
  // ==========================================
  // 小節9: レ レ ミ ド - 伴奏コード: G→C
  { step: 31, phrase: 3, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1, autoChord: ["G2", "G3", "B4"], autoOffbeat: [] },
  { step: 32, phrase: 3, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1, autoChord: ["B4"], autoOffbeat: [{ beat: 0.5, notes: ["G2", "G3"] }] },
  { step: 33, phrase: 3, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["G2", "G3", "C5"], autoOffbeat: [] },
  { step: 34, phrase: 3, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 1, autoChord: ["C3", "E3", "E4"], autoOffbeat: [] },
  // 小節10: レ ミ(短) ファ(短) ミ ド - 伴奏コード: G→C
  { step: 35, phrase: 3, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1, autoChord: ["G2", "G3", "B4"], autoOffbeat: [] },
  { step: 36, phrase: 3, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 0.5, autoChord: ["C5"], autoOffbeat: [] },
  { step: 37, phrase: 3, fingerNum: 4, fingerKey: "RING",   note: "ファ",  rightNote: "F5", freq: 698.46, beats: 0.5, autoChord: ["G2", "G3", "D5"], autoOffbeat: [] },
  { step: 38, phrase: 3, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["G2", "G3", "C5"], autoOffbeat: [] },
  { step: 39, phrase: 3, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 1, autoChord: ["C3", "E3", "E4"], autoOffbeat: [] },
  // 小節11: レ ミ(短) ファ(短) ミ レ - 伴奏コード: G→Am→E
  { step: 40, phrase: 3, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1, autoChord: ["G2", "G3", "B4"], autoOffbeat: [] },
  { step: 41, phrase: 3, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 0.5, autoChord: ["C5"], autoOffbeat: [] },
  { step: 42, phrase: 3, fingerNum: 4, fingerKey: "RING",   note: "ファ",  rightNote: "F5", freq: 698.46, beats: 0.5, autoChord: ["G2", "G3", "D5"], autoOffbeat: [] },
  { step: 43, phrase: 3, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["A2", "A3", "B4"], autoOffbeat: [] },
  { step: 44, phrase: 3, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1, autoChord: ["E3", "B4"], autoOffbeat: [] },
  // 小節12: ド レ ソ(低) ＋4拍目に次のミ(step 48)を先取りしタイで小節13へ - 伴奏コード: Am→D→G
  { step: 45, phrase: 3, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 1, autoChord: ["A2", "C3", "A4"], autoOffbeat: [] },
  { step: 46, phrase: 3, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1, autoChord: ["D3", "G3", "F#4"], autoOffbeat: [] },
  { step: 47, phrase: 3, fingerNum: 5, fingerKey: "PINKY",  note: "ソ",   rightNote: "G4", freq: 392.00, beats: 1, autoChord: ["G2", "G3", "B3"], autoOffbeat: [] },

  // ==========================================
  // 第4節（フレーズ4）: ミ ミ ファ ソ ｜ ソ ファ ミ レ ｜ ド ド レ ミ ｜ レ ド ド ─
  // ==========================================
  // 小節13: (⌒ミ) ミ ファ ソ - 伴奏コード: G→C（step 48 は小節12の4拍目に打鍵、1拍後に C3+C4）
  { step: 48, phrase: 4, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 2, autoChord: ["G2", "E3", "C5"], autoOffbeat: [{ beat: 1, notes: ["C3", "C4"] }] },
  { step: 49, phrase: 4, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["C5"], autoOffbeat: [{ beat: 0.5, notes: ["C3", "C4"] }] },
  { step: 50, phrase: 4, fingerNum: 4, fingerKey: "RING",   note: "ファ",  rightNote: "F5", freq: 698.46, beats: 1, autoChord: ["E3", "C4", "D5"], autoOffbeat: [] },
  { step: 51, phrase: 4, fingerNum: 5, fingerKey: "PINKY",  note: "ソ",   rightNote: "G5", freq: 783.99, beats: 1, autoChord: ["G3", "E5"], autoOffbeat: [] },
  // 小節14: ソ ファ ミ レ - 伴奏コード: G
  { step: 52, phrase: 4, fingerNum: 5, fingerKey: "PINKY",  note: "ソ",   rightNote: "G5", freq: 783.99, beats: 1, autoChord: ["G2", "G3", "E5"], autoOffbeat: [] },
  { step: 53, phrase: 4, fingerNum: 4, fingerKey: "RING",   note: "ファ",  rightNote: "F5", freq: 698.46, beats: 1, autoChord: ["D5"], autoOffbeat: [{ beat: 0.5, notes: ["G2", "G3"] }] },
  { step: 54, phrase: 4, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["B2", "G3", "C5"], autoOffbeat: [] },
  { step: 55, phrase: 4, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1, autoChord: ["D3", "G4"], autoOffbeat: [] },
  // 小節15: ド ド レ ミ - 伴奏コード: C
  { step: 56, phrase: 4, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 1, autoChord: ["C3", "G3", "E4", "G4"], autoOffbeat: [] },
  { step: 57, phrase: 4, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 1, autoChord: ["E4"], autoOffbeat: [{ beat: 0.5, notes: ["C3", "G3"] }] },
  { step: 58, phrase: 4, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1, autoChord: ["E3", "G3", "G4"], autoOffbeat: [] },
  { step: 59, phrase: 4, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ",   rightNote: "E5", freq: 659.25, beats: 1, autoChord: ["G2", "E4", "G4", "C5"], autoOffbeat: [] },
  // 小節16: レ ド ド ─ - 伴奏コード: G→C
  { step: 60, phrase: 4, fingerNum: 2, fingerKey: "INDEX",  note: "レ",   rightNote: "D5", freq: 587.33, beats: 1.5, autoChord: ["B2", "D3", "G3", "D4", "G4", "B4"], autoOffbeat: [] },
  { step: 61, phrase: 4, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 0.5, autoChord: ["E4"], autoOffbeat: [] },
  { step: 62, phrase: 4, fingerNum: 1, fingerKey: "THUMB",  note: "ド",   rightNote: "C5", freq: 523.25, beats: 2, autoChord: ["C3", "E3", "G3", "E4", "G4"], autoOffbeat: [] }
];

// 『メリーさんのひつじ（Mary Had a Little Lamb）』運指・音名シーケンス定義（右手4音 C5, D5, E5, G5・自動伴奏 C3, G3・全8小節/26音）
// ※演奏者は右手のみを使用します（左手の操作・打鍵指示は一切ありません。低音はアプリ側の自動伴奏音です）
// 1:親指(C5/ド), 2:人差し指(D5/レ), 3:中指(E5/ミ★第1音), 5:小指(G5/ソ)
export const MARY_HAD_A_LITTLE_LAMB_SEQUENCE = [
  // ==========================================
  // 前半（フレーズ1）: ミ レ ド レ ｜ ミ ミ ミ ─ ｜ レ レ レ ─ ｜ ミ ソ ソ ─
  // ==========================================
  // 小節1: ミ レ ド レ - 自動伴奏: C3
  { step: 1,  phrase: 1, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ", rightNote: "E5", freq: 659.25, autoLeftNote: "C3" },
  { step: 2,  phrase: 1, fingerNum: 2, fingerKey: "INDEX",  note: "レ", rightNote: "D5", freq: 587.33, autoLeftNote: null },
  { step: 3,  phrase: 1, fingerNum: 1, fingerKey: "THUMB",  note: "ド", rightNote: "C5", freq: 523.25, autoLeftNote: null },
  { step: 4,  phrase: 1, fingerNum: 2, fingerKey: "INDEX",  note: "レ", rightNote: "D5", freq: 587.33, autoLeftNote: null },
  // 小節2: ミ ミ ミ ─ - 自動伴奏: C3
  { step: 5,  phrase: 1, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ", rightNote: "E5", freq: 659.25, autoLeftNote: "C3" },
  { step: 6,  phrase: 1, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ", rightNote: "E5", freq: 659.25, autoLeftNote: null },
  { step: 7,  phrase: 1, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ", rightNote: "E5", freq: 659.25, autoLeftNote: null },
  // 小節3: レ レ レ ─ - 自動伴奏: G3
  { step: 8,  phrase: 1, fingerNum: 2, fingerKey: "INDEX",  note: "レ", rightNote: "D5", freq: 587.33, autoLeftNote: "G3" },
  { step: 9,  phrase: 1, fingerNum: 2, fingerKey: "INDEX",  note: "レ", rightNote: "D5", freq: 587.33, autoLeftNote: null },
  { step: 10, phrase: 1, fingerNum: 2, fingerKey: "INDEX",  note: "レ", rightNote: "D5", freq: 587.33, autoLeftNote: null },
  // 小節4: ミ ソ ソ ─ - 自動伴奏: C3
  { step: 11, phrase: 1, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ", rightNote: "E5", freq: 659.25, autoLeftNote: "C3" },
  { step: 12, phrase: 1, fingerNum: 5, fingerKey: "PINKY",  note: "ソ", rightNote: "G5", freq: 783.99, autoLeftNote: null },
  { step: 13, phrase: 1, fingerNum: 5, fingerKey: "PINKY",  note: "ソ", rightNote: "G5", freq: 783.99, autoLeftNote: null },

  // ==========================================
  // 後半（フレーズ2）: ミ レ ド レ ｜ ミ ミ ミ ミ ｜ レ レ ミ レ ｜ ド ─ ─ ─
  // ==========================================
  // 小節5: ミ レ ド レ - 自動伴奏: C3
  { step: 14, phrase: 2, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ", rightNote: "E5", freq: 659.25, autoLeftNote: "C3" },
  { step: 15, phrase: 2, fingerNum: 2, fingerKey: "INDEX",  note: "レ", rightNote: "D5", freq: 587.33, autoLeftNote: null },
  { step: 16, phrase: 2, fingerNum: 1, fingerKey: "THUMB",  note: "ド", rightNote: "C5", freq: 523.25, autoLeftNote: null },
  { step: 17, phrase: 2, fingerNum: 2, fingerKey: "INDEX",  note: "レ", rightNote: "D5", freq: 587.33, autoLeftNote: null },
  // 小節6: ミ ミ ミ ミ - 自動伴奏: C3
  { step: 18, phrase: 2, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ", rightNote: "E5", freq: 659.25, autoLeftNote: "C3" },
  { step: 19, phrase: 2, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ", rightNote: "E5", freq: 659.25, autoLeftNote: null },
  { step: 20, phrase: 2, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ", rightNote: "E5", freq: 659.25, autoLeftNote: null },
  { step: 21, phrase: 2, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ", rightNote: "E5", freq: 659.25, autoLeftNote: null },
  // 小節7: レ レ ミ レ - 自動伴奏: G3
  { step: 22, phrase: 2, fingerNum: 2, fingerKey: "INDEX",  note: "レ", rightNote: "D5", freq: 587.33, autoLeftNote: "G3" },
  { step: 23, phrase: 2, fingerNum: 2, fingerKey: "INDEX",  note: "レ", rightNote: "D5", freq: 587.33, autoLeftNote: null },
  { step: 24, phrase: 2, fingerNum: 3, fingerKey: "MIDDLE", note: "ミ", rightNote: "E5", freq: 659.25, autoLeftNote: null },
  { step: 25, phrase: 2, fingerNum: 2, fingerKey: "INDEX",  note: "レ", rightNote: "D5", freq: 587.33, autoLeftNote: null },
  // 小節8: ド ─ ─ ─ - 自動伴奏: C3
  { step: 26, phrase: 2, fingerNum: 1, fingerKey: "THUMB",  note: "ド", rightNote: "C5", freq: 523.25, autoLeftNote: "C3" }
];

// 演奏曲リスト（自分のペースで1音ずつ進めるステップ演奏）
export const SONGS = {
  ode_to_joy: {
    id: "ode_to_joy",
    title: "よろこびのうた",
    sequence: ODE_TO_JOY_SEQUENCE
  },
  mary_had_a_little_lamb: {
    id: "mary_had_a_little_lamb",
    title: "メリーさんのひつじ",
    sequence: MARY_HAD_A_LITTLE_LAMB_SEQUENCE
  }
};

export let currentSongId = "ode_to_joy";
export let currentSequence = SONGS.ode_to_joy.sequence;
export let currentSongStep = 0; // 現在の進行ステップ (0 〜 sequence.length - 1)
export let currentFingerKey = currentSequence[0].fingerKey; // 初期ターゲット指: MIDDLE (3: ミ)

// ==========================================
// 自動伴奏（和音・裏拍）の発音管理
// ==========================================
const ACCOMP_VELOCITY = 0.45;          // 伴奏音量（メロディ=1）
const DEFAULT_BEAT_MS = 600;           // 打鍵テンポが未計測のときの1拍の長さ
const MIN_BEAT_MS = 250;
const MAX_BEAT_MS = 1500;
let estimatedBeatMs = DEFAULT_BEAT_MS; // 演奏者の打鍵ペースから推定した1拍の長さ
let lastHitTime = null;
let lastHitBeats = null;
let pendingOffbeatTimers = [];

function cancelPendingOffbeats() {
  pendingOffbeatTimers.forEach((id) => clearTimeout(id));
  pendingOffbeatTimers = [];
}

/**
 * 伴奏状態のリセット（曲の切り替え・ループ時）
 */
export function resetAccompaniment() {
  cancelPendingOffbeats();
  estimatedBeatMs = DEFAULT_BEAT_MS;
  lastHitTime = null;
  lastHitBeats = null;
}

/**
 * 打鍵した音符の伴奏を鳴らす
 * - autoChord: 打鍵と同時に発音
 * - autoOffbeat: 推定テンポに合わせて打鍵の beat 拍後に発音（次の打鍵が先に来たら取り消し）
 * - autoLeftNote: 単音伴奏のみの曲（メリーさんのひつじ等）との互換
 * @param {object} target 打鍵したシーケンス要素
 */
function playAccompaniment(target) {
  const now = performance.now();
  // 前回の打鍵からの経過時間 ÷ 前の音符の拍数 で1拍の長さを推定（極端な値は除外し平滑化）
  if (lastHitTime !== null && lastHitBeats) {
    const beatMs = (now - lastHitTime) / lastHitBeats;
    if (beatMs >= MIN_BEAT_MS && beatMs <= MAX_BEAT_MS) {
      estimatedBeatMs = estimatedBeatMs * 0.6 + beatMs * 0.4;
    }
  }
  lastHitTime = now;
  lastHitBeats = target.beats || 1;

  cancelPendingOffbeats();

  if (Array.isArray(target.autoChord)) {
    target.autoChord.forEach((n) => playTapSound(n, false, ACCOMP_VELOCITY));
  } else if (target.autoLeftNote) {
    playTapSound(target.autoLeftNote, false);
  }

  if (Array.isArray(target.autoOffbeat)) {
    target.autoOffbeat.forEach(({ beat, notes }) => {
      const id = setTimeout(() => {
        notes.forEach((n) => playTapSound(n, false, ACCOMP_VELOCITY));
      }, beat * estimatedBeatMs);
      pendingOffbeatTimers.push(id);
    });
  }
}

// 3秒カウントダウン状態管理
export let isCountingDown = false;
let countdownTimerId = null;

/**
 * 3秒カウントダウンの実行（3 → 2 → 1 → START!）
 * @param {Function} callback カウントダウン完了後のコールバック
 */
export function startCountdown(callback) {
  if (countdownTimerId) {
    clearInterval(countdownTimerId);
    countdownTimerId = null;
  }
  isCountingDown = true;
  tapState = "IDLE";
  updateStateHud("COUNTDOWN", false);

  const overlay = document.getElementById("countdown-overlay");
  const textEl = document.getElementById("countdown-text");
  if (!overlay || !textEl) {
    isCountingDown = false;
    if (callback) callback();
    return;
  }

  overlay.classList.remove("hidden");
  let count = 3;
  textEl.textContent = `${count}`;
  textEl.style.transform = "scale(1.2)";
  setTimeout(() => {
    if (textEl) textEl.style.transform = "scale(1.0)";
  }, 60);

  countdownTimerId = setInterval(() => {
    count--;
    if (count > 0) {
      textEl.textContent = `${count}`;
      textEl.style.transform = "scale(1.2)";
      setTimeout(() => {
        if (textEl) textEl.style.transform = "scale(1.0)";
      }, 60);
    } else if (count === 0) {
      textEl.textContent = "START!";
      textEl.style.transform = "scale(1.3)";
      setTimeout(() => {
        if (textEl) textEl.style.transform = "scale(1.0)";
      }, 60);
    } else {
      clearInterval(countdownTimerId);
      countdownTimerId = null;
      overlay.classList.add("hidden");
      isCountingDown = false;
      updateStateHud("IDLE", false);
      if (callback) callback();
    }
  }, 1000);
}

// 完走クリア演出の状態管理（クリア演出中は打鍵認識を一時停止）
export let isClearing = false;
let clearTimerId = null;

/**
 * 完走時の白黒ミニマルクリア通知のフェード表示（約1.5秒間）
 * @param {Function} onComplete フェードアウト完了後のコールバック
 */
export function showClearNotification(onComplete) {
  const overlay = document.getElementById("clear-overlay");
  if (!overlay) {
    if (onComplete) onComplete();
    return;
  }

  isClearing = true;
  overlay.classList.remove("hidden");
  // 強制リフローまたは微小ディレイでCSS opacity トランジションを確実に開始
  requestAnimationFrame(() => {
    overlay.classList.add("show");
  });

  if (clearTimerId) clearTimeout(clearTimerId);

  // 約1.5秒間シンプルにフェード表示した後、フェードアウトしてループ復帰
  clearTimerId = setTimeout(() => {
    overlay.classList.remove("show");
    setTimeout(() => {
      overlay.classList.add("hidden");
      isClearing = false;
      if (onComplete) onComplete();
    }, 300); // CSSのtransition 0.3s完了後にhidden化
  }, 1500);
}

/**
 * 楽曲の切り替え
 * @param {string} songId
 * @param {boolean} withCountdown カウントダウンを開始するかどうか（起動時は手動制御）
 */
export function selectSong(songId, withCountdown = true) {
  if (!SONGS[songId]) return;

  // クリア演出中であればタイマーとオーバーレイをリセット
  if (clearTimerId) {
    clearTimeout(clearTimerId);
    clearTimerId = null;
  }
  isClearing = false;
  const clearOverlay = document.getElementById("clear-overlay");
  if (clearOverlay) {
    clearOverlay.classList.remove("show");
    clearOverlay.classList.add("hidden");
  }

  currentSongId = songId;
  currentSequence = SONGS[songId].sequence;
  currentSongStep = 0;
  resetAccompaniment();

  // 右上ポップアップメニューのアクティブクラス更新
  document.querySelectorAll(".song-menu-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.song === songId);
  });

  // 起動モーダルの選択状態も同期
  document.querySelectorAll(".start-song-item").forEach((btn) => {
    const isSelected = btn.dataset.song === songId;
    btn.classList.toggle("selected", isSelected);
    const check = btn.querySelector(".start-song-check");
    if (check) check.textContent = isSelected ? "●" : "○";
  });

  // メニューを閉じる
  const menu = document.getElementById("song-select-menu");
  if (menu) menu.classList.add("hidden");

  // 1音目のターゲット指をセット＆ガイドUI再描画
  setTargetFinger(currentSequence[0].fingerKey);
  renderSongGuideUI();

  if (withCountdown) {
    // カウントダウン開始
    startCountdown(() => {
      console.log(`[SONG] ${SONGS[songId].title} 開始！第1音: ${currentSequence[0].note} (${currentSequence[0].fingerKey})`);
    });
  }
}

// 手の全21ランドマーク専用の適応平滑化フィルター（1 Euro Filter）
// 手首（0）から親指・人差し指・中指・薬指・小指（20）まで全関節を独立して常時平滑化
const landmarkFilters = Array.from({ length: 21 }, () => new PointFilter(1.2, 0.008));

// 全21関節点用の平滑化座標オブジェクトプール（毎フレームの新規オブジェクト生成・破棄によるGCスパイクを完全排除）
const smoothedLandmarksPool = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));

// 一時的な検出ロスト対策（打鍵時の陰影による瞬断で骨格が点滅・ジャンプするのを防止しつつ、退出時は約0.1秒で即消去）
let lostFrames = 0;
const MAX_LOST_FRAMES = 6;
let hasValidSmoothedLandmarks = false;
let lastRawLandmarks = null;

// 右手トラッキングロック用：追従中の右手手首（Landmark 0）の正規化座標
let lastTrackedWrist = null;

// 手の骨格コネクション定義（全21ランドマーク間の接続ペア [startIdx, endIdx]）
const HAND_CONNECTIONS = [
  // 手のひら
  [0, 1], [0, 5], [5, 9], [9, 13], [13, 17], [0, 17],
  // 親指
  [1, 2], [2, 3], [3, 4],
  // 人差し指（背景薄表示）
  [5, 6], [6, 7], [7, 8],
  // 中指
  [9, 10], [10, 11], [11, 12],
  // 薬指
  [13, 14], [14, 15], [15, 16],
  // 小指
  [17, 18], [18, 19], [19, 20]
];

// 指ごとの対象外骨格接続線のキャッシュ（毎フレームのfilter処理・配列アロケーションを完全排除）
const cachedOtherConnections = {};
export let currentOtherConnections = [];

/**
 * ターゲット指変更時の骨格接続線キャッシュ更新
 * @param {string} fingerKey
 */
export function updateCachedConnections(fingerKey) {
  if (cachedOtherConnections[fingerKey]) {
    currentOtherConnections = cachedOtherConnections[fingerKey];
    return;
  }
  const cfg = FINGER_CONFIGS[fingerKey] || FINGER_CONFIGS.THUMB;
  const targetIndices = cfg.indices;
  const connections = HAND_CONNECTIONS.filter(
    ([s, e]) => !(targetIndices.includes(s) && targetIndices.includes(e))
  );
  cachedOtherConnections[fingerKey] = connections;
  currentOtherConnections = connections;
}

// 指ごとの学習閾値モデル
// 親指（THUMB）は机面への垂直変位が小さいため、初期閾値を緩和（0.55 / 0.40）
export const fingerThresholdModels = {
  THUMB: { hitRy: 0.55, liftRy: 0.40, samples: 0 },
  MIDDLE: { hitRy: 0.80, liftRy: 0.55, samples: 0 },
  RING: { hitRy: 0.82, liftRy: 0.57, samples: 0 },
  PINKY: { hitRy: 0.80, liftRy: 0.55, samples: 0 },
  INDEX: { hitRy: 0.80, liftRy: 0.55, samples: 0 }
};

// 指ごとのデータセット格納用
export const fingerDatasets = {
  THUMB: [],
  MIDDLE: [],
  RING: [],
  PINKY: [],
  INDEX: []
};

/**
 * ターゲット指の変更と個別閾値の適用
 * ※指が切り替わっても全ランドマークフィルターはリセットせず継続し、座標飛びを防止
 * @param {string} fingerKey
 */
export function setTargetFinger(fingerKey) {
  if (!FINGER_CONFIGS[fingerKey]) return;
  currentFingerKey = fingerKey;

  // 骨格接続線キャッシュを更新
  updateCachedConnections(fingerKey);

  // 指別学習モデルの閾値を適用
  applyFingerThreshold(fingerKey);

  console.log(`[FINGER TARGET] ターゲット指: ${FINGER_CONFIGS[fingerKey].label} (TH: ${hitRyThreshold.toFixed(2)})`);
}

// 初回ターゲット指の骨格接続線を初期化
updateCachedConnections(currentFingerKey);

/**
 * 楽曲進行とターゲット指UIの更新
 */
export function renderSongGuideUI() {
  const currentItem = currentSequence[currentSongStep];
  if (!currentItem) return;

  if (targetFingerVal) {
    const fingerName = FINGER_NAMES[currentItem.fingerKey] || currentItem.fingerKey;
    targetFingerVal.textContent = `右手 ${currentItem.fingerNum} ${currentItem.note} (${fingerName})`;
    targetFingerVal.classList.add("spike-highlight");
    setTimeout(() => {
      if (targetFingerVal) targetFingerVal.classList.remove("spike-highlight");
    }, 200);
  }
  if (targetTapProgress) {
    targetTapProgress.textContent = `${currentItem.step} / ${currentSequence.length}`;
  }
  // 画面上部：ミニマル進捗バッジ（白黒ミニマル）
  if (songProgressBadge) {
    songProgressBadge.textContent = `${currentItem.step} / ${currentSequence.length}`;
  }
}

/**
 * 現在の音符のハイライト色を取得
 * - 複数弾く指（同一指の連続）：1打目＝黄色、2打目＝緑色、3打目＝青色
 * - 単発（1回のみ弾く指）：水色（シアン）
 * @param {number} stepIndex
 */
export function getTargetFingerColor(stepIndex) {
  const current = currentSequence[stepIndex];
  if (!current) {
    return {
      stroke: "rgba(0, 229, 255, 0.95)",
      halo: "rgba(0, 229, 255, 0.25)",
      accent: "rgba(0, 229, 255, 0.65)",
      glow: "rgba(0, 229, 255, 0.8)",
      fill: "#00e5ff",
      r: 0,
      g: 229,
      b: 255,
      rgb: "0, 229, 255",
      name: "cyan"
    };
  }

  // 連続打鍵グループの先頭を探索
  let start = stepIndex;
  while (start > 0 && currentSequence[start - 1].fingerKey === current.fingerKey) {
    start--;
  }

  // 連続打鍵グループの末尾を探索
  let end = stepIndex;
  while (end < currentSequence.length - 1 && currentSequence[end + 1].fingerKey === current.fingerKey) {
    end++;
  }

  const groupLen = end - start + 1;
  const idxInGroup = stepIndex - start; // 0: 1打目, 1: 2打目, 2: 3打目

  if (groupLen > 1) {
    if (idxInGroup === 0) {
      // 1打目: 黄色 (Yellow)
      return {
        stroke: "rgba(255, 230, 0, 0.95)",
        halo: "rgba(255, 230, 0, 0.25)",
        accent: "rgba(255, 230, 0, 0.65)",
        glow: "rgba(255, 230, 0, 0.85)",
        fill: "#fff700",
        r: 255,
        g: 230,
        b: 0,
        rgb: "255, 230, 0",
        name: "yellow"
      };
    } else if (idxInGroup === 1) {
      // 2打目: 緑色 (Green)
      return {
        stroke: "rgba(0, 255, 136, 0.95)",
        halo: "rgba(0, 255, 136, 0.25)",
        accent: "rgba(0, 255, 136, 0.65)",
        glow: "rgba(0, 255, 136, 0.85)",
        fill: "#00ff88",
        r: 0,
        g: 255,
        b: 136,
        rgb: "0, 255, 136",
        name: "green"
      };
    } else {
      // 3打目: 青色 (Blue)
      return {
        stroke: "rgba(0, 180, 255, 0.95)",
        halo: "rgba(0, 180, 255, 0.25)",
        accent: "rgba(0, 180, 255, 0.65)",
        glow: "rgba(0, 180, 255, 0.85)",
        fill: "#00b4d8",
        r: 0,
        g: 180,
        b: 255,
        rgb: "0, 180, 255",
        name: "blue"
      };
    }
  }

  // 単発: 水色 (Cyan)
  return {
    stroke: "rgba(0, 229, 255, 0.95)",
    halo: "rgba(0, 229, 255, 0.25)",
    accent: "rgba(0, 229, 255, 0.65)",
    glow: "rgba(0, 229, 255, 0.85)",
    fill: "#00e5ff",
    r: 0,
    g: 229,
    b: 255,
    rgb: "0, 229, 255",
    name: "cyan"
  };
}

// 次の指への指定ビームエフェクト管理配列
export const tapVisualEffects = [];

/**
 * 次の指へ飛んでいく光のラインエフェクト（指定ビーム）を生成
 * @param {number} fromX 始点X
 * @param {number} fromY 始点Y
 * @param {number} toX 終点X
 * @param {number} toY 終点Y
 * @param {object} color 次の音符の色
 */
export function spawnBeamEffect(fromX, fromY, toX, toY, color) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);

  // 制御点（始点と終点の中点から上空へ持ち上げてダイナミックなアーチを描く）
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2 - Math.min(80, Math.max(30, dist * 0.35));

  // RGB文字列の事前キャッシュ（ループ内の正規表現全廃のため）
  const colorRgb = color?.rgb || (color?.r !== undefined ? `${color.r}, ${color.g}, ${color.b}` : "0, 229, 255");

  tapVisualEffects.push({
    type: "beam",
    fromX,
    fromY,
    toX,
    toY,
    midX,
    midY,
    progress: 0.0,
    speed: 0.055, // 約18フレームで軽快に着弾
    trail: [],    // 軌跡座標履歴
    color,
    colorRgb
  });
}

/**
 * 次の指への指定ビームエフェクトの更新＆描画（GPU負荷を抑えた高速・滑らか描画）
 * @param {CanvasRenderingContext2D} ctx
 */
export function updateAndDrawTapEffects(ctx) {
  if (tapVisualEffects.length === 0) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = tapVisualEffects.length - 1; i >= 0; i--) {
    const fx = tapVisualEffects[i];

    if (fx.type === "beam") {
      fx.progress += fx.speed;
      const t = Math.min(1.0, fx.progress);

      // 2次ベジェ曲線補間 B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
      const invT = 1.0 - t;
      const curX = invT * invT * fx.fromX + 2 * invT * t * fx.midX + t * t * fx.toX;
      const curY = invT * invT * fx.fromY + 2 * invT * t * fx.midY + t * t * fx.toY;

      // 軌跡の追加（unshiftによる全要素シフトを排除し、push/shiftによる軽量管理方式に変更）
      fx.trail.push({ x: curX, y: curY });
      if (fx.trail.length > 18) {
        fx.trail.shift();
      }

      // ビーム軌跡のバッチ描画（セグメント細切れstrokeを廃止し、3区間にまとめてドローコールを最小化）
      const trailLen = fx.trail.length;
      if (trailLen > 1) {
        const BATCH_COUNT = 3;
        const colorRgb = fx.colorRgb || fx.color?.rgb || "0, 229, 255";

        // パス1: 外側のネオン光条ライン（3バッチにまとめてドローコール削減）
        for (let s = 0; s < BATCH_COUNT; s++) {
          const startIdx = Math.floor((s * (trailLen - 1)) / BATCH_COUNT);
          const endIdx = Math.floor(((s + 1) * (trailLen - 1)) / BATCH_COUNT);
          if (startIdx >= endIdx) continue;

          // 軌跡の進行度（0.0: 最も古い尾部, 1.0: 最新の先端部）
          const prog = (startIdx + endIdx) / (2 * (trailLen - 1));
          const trailAlpha = prog * (1.0 - t * 0.2);

          ctx.beginPath();
          ctx.moveTo(fx.trail[startIdx].x, fx.trail[startIdx].y);
          for (let k = startIdx + 1; k <= endIdx; k++) {
            ctx.lineTo(fx.trail[k].x, fx.trail[k].y);
          }
          ctx.strokeStyle = `rgba(${colorRgb}, ${(trailAlpha * 0.85).toFixed(2)})`;
          ctx.lineWidth = Math.max(2.0, 9.0 * trailAlpha);
          ctx.stroke();
        }

        // パス2: 内側の高輝度ホワイトコア（3バッチにまとめてドローコール削減）
        for (let s = 0; s < BATCH_COUNT; s++) {
          const startIdx = Math.floor((s * (trailLen - 1)) / BATCH_COUNT);
          const endIdx = Math.floor(((s + 1) * (trailLen - 1)) / BATCH_COUNT);
          if (startIdx >= endIdx) continue;

          const prog = (startIdx + endIdx) / (2 * (trailLen - 1));
          const trailAlpha = prog * (1.0 - t * 0.2);

          ctx.beginPath();
          ctx.moveTo(fx.trail[startIdx].x, fx.trail[startIdx].y);
          for (let k = startIdx + 1; k <= endIdx; k++) {
            ctx.lineTo(fx.trail[k].x, fx.trail[k].y);
          }
          ctx.strokeStyle = `rgba(255, 255, 255, ${(trailAlpha * 0.95).toFixed(2)})`;
          ctx.lineWidth = Math.max(1.0, 3.5 * trailAlpha);
          ctx.stroke();
        }
      }

      // 先頭の光球（外周カラー 半径 7px + 中心ホワイトコア 半径 3.5px）
      ctx.beginPath();
      ctx.arc(curX, curY, 7.0, 0, 2 * Math.PI);
      ctx.fillStyle = fx.color.fill;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(curX, curY, 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.fill();

      // 終点着弾で消滅
      if (t >= 1.0) {
        tapVisualEffects.splice(i, 1);
      }
    }
  }
  ctx.restore();
}

/**
 * 指定指の学習済み閾値をアクティブ閾値にセット
 * @param {string} fingerKey
 */
export function applyFingerThreshold(fingerKey) {
  const model = fingerThresholdModels[fingerKey];
  if (model) {
    hitRyThreshold = model.hitRy;
    liftRyThreshold = model.liftRy;
    trainedHitSamples = model.samples;
  }
  if (thVal) {
    thVal.textContent = hitRyThreshold.toFixed(2);
  }
}


/**
 * CSVステータス表示の更新
 * @param {string} msg
 */
function updateCsvStatus(msg) {
  if (csvStatus) {
    csvStatus.textContent = msg;
  }
}

/**
 * CSVテキストをパースして相対変位ryおよび打鍵フラグを抽出
 * （timestamp,rx,ry,rz,vx,vy,vz,label 形式、および frame,timestamp,mcp_x... 形式の両方に対応）
 * @param {string} text CSVテキスト
 * @returns {Array<{ timestamp: number, ry: number, isHit: boolean }>}
 */
/**
 * CSVテキストをパースして相対変位ryおよび打鍵フラグを抽出
 * （打鍵ラベルが未付与のtapファイルの場合、変位ピークを自動検出して打鍵点として認識）
 * @param {string} text CSVテキスト
 * @param {string} filename ファイル名
 * @returns {Array<{ timestamp: number, ry: number, isHit: boolean }>}
 */
export function parseCsv(text, filename = "") {
  if (!text || typeof text !== "string") return [];
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0].toLowerCase();
  const headers = headerLine.split(",").map((h) => h.trim());

  const ryIdx = headers.indexOf("ry");
  const labelIdx = headers.indexOf("label") !== -1 ? headers.indexOf("label") : headers.indexOf("is_hit");
  const timeIdx = headers.indexOf("timestamp") !== -1 ? headers.indexOf("timestamp") : (headers.indexOf("timestamp_ms") !== -1 ? headers.indexOf("timestamp_ms") : headers.indexOf("time_sec"));

  const mcpYIdx = headers.indexOf("index_mcp_y") !== -1 ? headers.indexOf("index_mcp_y") : headers.indexOf("mcp_y");
  const tipYIdx = headers.indexOf("index_tip_y") !== -1 ? headers.indexOf("index_tip_y") : headers.indexOf("tip_y");

  const results = [];
  let manualHitCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",").map((c) => c.trim());

    let ry = null;
    let isHit = false;
    let timestamp = 0;

    if (timeIdx !== -1 && cols[timeIdx]) {
      timestamp = parseFloat(cols[timeIdx]) || 0;
    }

    if (labelIdx !== -1 && cols[labelIdx]) {
      isHit = parseInt(cols[labelIdx], 10) === 1;
      if (isHit) manualHitCount++;
    }

    if (ryIdx !== -1 && cols[ryIdx] !== undefined && cols[ryIdx] !== "") {
      ry = parseFloat(cols[ryIdx]);
    } else if (mcpYIdx !== -1 && tipYIdx !== -1 && cols[mcpYIdx] && cols[tipYIdx]) {
      const my = parseFloat(cols[mcpYIdx]);
      const ty = parseFloat(cols[tipYIdx]);
      if (!isNaN(my) && !isNaN(ty)) {
        ry = ty - my;
      }
    }

    if (ry !== null && !isNaN(ry)) {
      results.push({
        timestamp,
        ry,
        isHit
      });
    }
  }

  // もしファイル名に "tap" が含まれており、手動打鍵マークが0件の場合は自動ピーク検出を実行
  if (filename.toLowerCase().includes("tap") && manualHitCount === 0 && results.length > 10) {
    autoDetectTapPeaks(results);
  }

  return results;
}

/**
 * 打鍵データ波形から机面接触ピーク（極大点）を自動検出して isHit を付与
 * @param {Array<{ timestamp: number, ry: number, isHit: boolean }>} frames
 */
function autoDetectTapPeaks(frames) {
  const rys = frames.map((f) => f.ry);
  const len = rys.length;
  if (len < 5) return;

  // 全体の平均値と中央値を算出
  const sortedRys = [...rys].sort((a, b) => a - b);
  const medianRy = sortedRys[Math.floor(len * 0.5)];
  const p75Ry = sortedRys[Math.floor(len * 0.75)];

  let lastHitIdx = -100;
  let autoCount = 0;

  for (let i = 3; i < len - 3; i++) {
    const cur = rys[i];
    // 局所極大（前後より高く、かつ75%タイル以上の山）
    if (
      cur > rys[i - 1] &&
      cur >= rys[i + 1] &&
      cur > rys[i - 2] &&
      cur >= rys[i + 2] &&
      cur > p75Ry &&
      (cur - medianRy) > 0.08 &&
      (i - lastHitIdx) > 10 // クールダウン（最低10フレーム離れている）
    ) {
      frames[i].isHit = true;
      lastHitIdx = i;
      autoCount++;
    }
  }

  console.log(`[CSV PEAK] 打鍵ピーク自動検出: ${autoCount} 箇所の打鍵点を抽出 (Median=${medianRy.toFixed(2)}, P75=${p75Ry.toFixed(2)})`);
}

/**
 * 読み込んだ学習済みCSVデータから各指の打鍵判定閾値を自動導出
 */
function trainModelFromCsv() {
  const fingerKeys = ["THUMB", "MIDDLE", "RING", "PINKY", "INDEX"];
  for (const fKey of fingerKeys) {
    trainModelForFinger(fKey);
  }
  // 現在選択されている指の閾値を反映
  applyFingerThreshold(currentFingerKey);
}

/**
 * 特定指のデータセットから打鍵閾値を導出（負値変位・各指の可動域に完全対応）
 * @param {string} fingerKey
 */
function trainModelForFinger(fingerKey) {
  const datasets = fingerDatasets[fingerKey] || [];
  if (datasets.length === 0) return;

  const frames = datasets.flatMap((d) => d.frames);
  if (frames.length === 0) return;

  // 1. 打鍵データ（isHit = true）の抽出
  const hitRys = frames
    .filter((f) => f.isHit && f.ry !== null && !isNaN(f.ry))
    .map((f) => f.ry)
    .sort((a, b) => a - b);

  // 2. 空中動作データ（純粋な空中浮遊データ neg_air のみを使用）
  // ※ neg_idle (静止待機) や neg_slide (スライド) は机面接触を含むため空中基準から除外
  const airDatasets = datasets.filter((d) => {
    const fn = d.filename.toLowerCase();
    return fn.includes("neg_air");
  });

  let maxAirRy = -Infinity;
  if (airDatasets.length > 0) {
    const airFrames = airDatasets.flatMap((d) => d.frames);
    const validAirRys = airFrames
      .filter((f) => f.ry !== null && !isNaN(f.ry))
      .map((f) => f.ry)
      .sort((a, b) => a - b);
    if (validAirRys.length > 0) {
      // 90パーセンタイルを空中最大変位として採用（異常外れ値をカット）
      maxAirRy = validAirRys[Math.floor(validAirRys.length * 0.90)];
    }
  }

  // 空中データが無い場合は打鍵以外のデータの下位70%を参照
  if (maxAirRy === -Infinity) {
    const negRys = frames
      .filter((f) => !f.isHit && f.ry !== null && !isNaN(f.ry))
      .map((f) => f.ry)
      .sort((a, b) => a - b);
    maxAirRy = negRys.length > 0 ? negRys[Math.floor(negRys.length * 0.70)] : 0.0;
  }

  const samples = hitRys.length;
  let hitTh = 0.0;
  let liftTh = 0.0;

  if (samples > 0) {
    // 打鍵サンプルの中央値・第25%パーセンタイル値
    const medianHitRy = hitRys[Math.floor(samples * 0.50)];
    const p25HitRy = hitRys[Math.floor(samples * 0.25)];

    if (medianHitRy > maxAirRy) {
      // 空中最大と打鍵中央値の中間点に打鍵閾値を設定
      // 薬指（RING）は他指（中指・小指）との連動によるつられ下がり誤検知を防ぐため、やや高め（0.46）に設定
      // 親指（THUMB）は机面への垂直変位が小さいため緩和（0.30）して反応感度を向上
      const hitRatio = fingerKey === "THUMB" ? 0.30 : (fingerKey === "RING" ? 0.46 : 0.45);
      hitTh = maxAirRy + (medianHitRy - maxAirRy) * hitRatio;

      // リフト閾値：全指で打鍵位置からわずかに指を浮かせるだけで素早くIDLE復帰できるよう、
      // ヒステリシス幅を極小（0.03）に設定
      const hysteresis = 0.03;
      liftTh = hitTh - hysteresis;
    } else {
      // 外れ値等で打鍵中央値が空中を下回る場合の適応フォールバック
      hitTh = p25HitRy;
      liftTh = hitTh - 0.03;
    }
  } else {
    // 打鍵サンプルが0件の場合の安全マージン（親指は垂直変位が小さいため0.10、薬指は誤検知防止で0.20、他指は0.18）
    const safetyMargin = fingerKey === "THUMB" ? 0.10 : (fingerKey === "RING" ? 0.20 : 0.18);
    hitTh = maxAirRy + safetyMargin;
    liftTh = hitTh - 0.03;
  }

  fingerThresholdModels[fingerKey] = {
    hitRy: parseFloat(hitTh.toFixed(2)),
    liftRy: parseFloat(liftTh.toFixed(2)),
    samples
  };

  console.log(
    `[MODEL: ${fingerKey}] 学習完了: 打鍵=${samples}件 (空中Max=${maxAirRy.toFixed(3)}) -> 打鍵TH=${hitTh.toFixed(2)}, リフトTH=${liftTh.toFixed(2)}`
  );
}


/**
 * 複数CSVテキストを一括パースしてデータセット配列に格納
 * @param {Array<{ name: string, content: string }>} files
 */
function ingestCsvFiles(files) {
  for (const file of files) {
    const parsed = parseCsv(file.content, file.name);
    if (parsed.length > 0) {
      const existIdx = testDataDatasets.findIndex((d) => d.filename === file.name);
      const datasetEntry = {
        filename: file.name,
        frames: parsed,
        hitCount: parsed.filter((f) => f.isHit).length
      };

      if (existIdx !== -1) {
        testDataDatasets[existIdx] = datasetEntry;
      } else {
        testDataDatasets.push(datasetEntry);
      }
    }
  }

  // 全フレームのフラット配列を生成
  testDataFrames = testDataDatasets.flatMap((d) => d.frames);

  if (testDataDatasets.length > 0) {
    const totalHits = testDataFrames.filter((f) => f.isHit).length;
    trainModelFromCsv();
    updateCsvStatus(`LOADED (${testDataDatasets.length} files, ${totalHits} hits)`);
    console.log(
      `[CSV] 全読込成功: 計 ${testDataDatasets.length} ファイル, ${testDataFrames.length} フレーム (打鍵マーク: ${totalHits})`
    );
  } else {
    updateCsvStatus("NOT LOADED");
    if (thVal) thVal.textContent = hitRyThreshold.toFixed(2);
  }
}

/**
 * ファイルパスまたはファイル名から指キー（THUMB, MIDDLE, RING, PINKY, INDEX）を判定
 * @param {string} path
 * @returns {string}
 */
export function detectFingerKey(path) {
  const p = path.toLowerCase();
  if (p.includes("thumb")) return "THUMB";
  if (p.includes("middle")) return "MIDDLE";
  if (p.includes("ring")) return "RING";
  if (p.includes("pinky")) return "PINKY";
  if (p.includes("index")) return "INDEX";
  return "THUMB";
}

/**
 * public/dataset/ 配下の各指CSVデータセットを自動非同期フェッチして読み込む
 */
export async function loadTestDataCsv() {
  const loadedFiles = [];

  // 初期化
  Object.keys(fingerDatasets).forEach((k) => (fingerDatasets[k] = []));

  try {
    const manifestRes = await fetch("./dataset/manifest.json");
    if (manifestRes.ok) {
      const manifestData = await manifestRes.json();
      let fileList = [];
      if (Array.isArray(manifestData)) {
        fileList = manifestData;
      } else if (manifestData && typeof manifestData === "object") {
        if (manifestData.fingers) {
          fileList = Object.values(manifestData.fingers).flat();
        } else if (Array.isArray(manifestData.files)) {
          fileList = manifestData.files;
        }
      }

      for (const fname of fileList) {
        if (!fname) continue;
        try {
          const csvRes = await fetch(`./dataset/${fname}`);
          if (csvRes.ok) {
            const text = await csvRes.text();
            const displayName = fname.includes("/") ? fname.split("/").pop() : fname;
            const fingerKey = detectFingerKey(fname);
            const parsed = parseCsv(text, displayName);
            if (parsed.length > 0) {
              const entry = {
                filename: displayName,
                path: fname,
                fingerKey,
                frames: parsed,
                hitCount: parsed.filter((f) => f.isHit).length
              };
              fingerDatasets[fingerKey].push(entry);
              loadedFiles.push({ name: displayName, content: text });
            }
          }
        } catch (err) {
          console.warn(`[CSV] ${fname} の取得スキップ:`, err);
        }
      }
    }
  } catch (err) {
    console.warn("[CSV] manifest.json の読み込みをスキップ:", err);
  }

  if (loadedFiles.length > 0) {
    ingestCsvFiles(loadedFiles);
    trainModelFromCsv();
  } else {
    updateCsvStatus("NO CSV DATA");
    applyFingerThreshold(currentFingerKey);
  }
}


// 先行MediaPipeモデルロード用Promise
let handLandmarkerPromise = null;
let selectedStartSongId = "ode_to_joy";

/**
 * 初期化処理（アプリ内ブラウザ検知を先行）
 */
async function init() {
  // アプリ内ブラウザ（LINE, X, Instagram等）の検知と誘導
  const inAppInfo = detectInAppBrowser();
  if (inAppInfo.isInApp) {
    showInAppBrowserModal(inAppInfo, () => {
      prepareApp();
    });
    return;
  }

  prepareApp();
}

/**
 * 起動前準備（モデル読込の先行開始と楽曲選択モーダルのセットアップ）
 */
function prepareApp() {
  resetDebugMetrics();
  updateStatus("曲を選択してください");

  // テスト用CSVの非同期読み込み（未配置でもブロックせず実行）
  loadTestDataCsv();

  // MediaPipe Hand Landmarker の読み込みを先行バックグラウンド実行（スタート押下時の待ち時間を極小化）
  if (!handLandmarkerPromise) {
    handLandmarkerPromise = initHandLandmarker().catch((err) => {
      console.warn("先行モデル読込エラー（スタート時に再試行）:", err);
      handLandmarkerPromise = null;
    });
  }

  // 音声バナーは初期状態では隠す（スタートボタン押下で確実に有効化されるため）
  if (audioStartBanner) {
    audioStartBanner.classList.add("hidden");
  }

  // 起動モーダルのイベント初期化
  setupStartModal();
}

/**
 * 起動時楽曲選択モーダルのイベント登録
 */
function setupStartModal() {
  if (!startModal) return;

  const startSongItems = document.querySelectorAll(".start-song-item");
  startSongItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const songId = item.dataset.song;
      if (!songId || !SONGS[songId]) return;

      selectedStartSongId = songId;

      // 選択状態のUI更新
      startSongItems.forEach((btn) => {
        const isSelected = btn.dataset.song === songId;
        btn.classList.toggle("selected", isSelected);
        const check = btn.querySelector(".start-song-check");
        if (check) check.textContent = isSelected ? "●" : "○";
      });

      // ターゲット指やガイドUIも背景側で事前に反映しておく
      selectSong(songId, false);
    });
  });

  if (startPlayBtn) {
    startPlayBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await handleStartPlay();
    });
  }
}

/**
 * 「演奏を開始」ボタン押下時の実行処理（音声アンロック・カメラ起動・カウントダウン）
 */
async function handleStartPlay() {
  if (!startPlayBtn) return;

  // ボタンをローディング状態にして二重タップを防止
  startPlayBtn.disabled = true;
  if (startPlayText) startPlayText.textContent = "カメラ・AI起動中...";

  // 1. ユーザー操作（タップ）の同期スタック内で Web Audio API を即時有効化
  ensureAudioContext();

  // 音声バナーは不要なので非表示を確実に維持
  if (audioStartBanner) {
    audioStartBanner.classList.add("hidden");
  }

  try {
    updateStatus("モデル読込待機中...");
    if (handLandmarkerPromise) {
      await handLandmarkerPromise;
    } else {
      await initHandLandmarker();
    }

    // 選択された曲をセット（カウントダウンはカメラ起動後に行うため false）
    selectSong(selectedStartSongId, false);

    // 2. インカメラの起動（ユーザー操作コンテキスト内での実行）
    updateStatus("インカメラ起動中...");
    await startFrontCamera();

    // 3. 起動モーダルを非表示
    if (startModal) {
      startModal.classList.add("hidden");
    }

    // 4. カウントダウン（3・2・1・START!）を開始して演奏へ移行
    startCountdown(() => {
      console.log(`[START] 演奏開始: ${SONGS[selectedStartSongId].title}`);
    });
  } catch (error) {
    console.error("起動エラー:", error);
    startPlayBtn.disabled = false;
    if (startPlayText) startPlayText.textContent = "スタート";

    // 自動再生制限による起動保留の場合は、白黒ミニマルなタップ起動プロンプトを表示
    if (error.name === "AutoplayBlockedError") {
      updateStatus("タップ待機中");
      showCameraTapPrompt(async () => {
        try {
          updateStatus("カメラ再生中...");
          await video.play();
          updateCanvasResolution();
          isPredicting = true;
          schedulePredictLoop();
          if (startModal) startModal.classList.add("hidden");
          startCountdown(() => {
            console.log(`[START] 演奏開始: ${SONGS[selectedStartSongId].title}`);
          });
          updateStatus("トラッキング中");
        } catch (retryErr) {
          console.error("タップ後のカメラ起動エラー:", retryErr);
          const guidanceMsg = getCameraErrorMessage(retryErr);
          showCameraErrorOverlay(guidanceMsg);
          showError(retryErr.message || guidanceMsg);
          updateStatus("エラー停止");
        }
      });
      return;
    }

    const guidanceMsg = getCameraErrorMessage(error);
    showCameraErrorOverlay(guidanceMsg);
    showError(error.message || guidanceMsg);
    updateStatus("エラー停止");
  }
}

/**
 * MediaPipe Hand Landmarker の初期化
 */
async function initHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  const modelPaths = [
    "./models/hand_landmarker.task",
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
  ];

  let loaded = false;
  let lastErr = null;

  for (const modelPath of modelPaths) {
    try {
      // 画面内に左手が存在していても右手を見落とさず確実に追従・ロックするため両手（最大2手）検出を有効化
      // 水平ローアングルでの打鍵時（机面接触・影）の再検出ループを防ぐため追従閾値を適正化
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.3
      });
      loaded = true;
      break;
    } catch (gpuErr) {
      console.warn("GPU失敗、CPUへフォールバック:", gpuErr);
      try {
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelPath,
            delegate: "CPU"
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.4,
          minHandPresenceConfidence: 0.4,
          minTrackingConfidence: 0.3
        });
        loaded = true;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
  }

  if (!loaded) {
    throw new Error(`モデルロード失敗: ${lastErr?.message || "不明なエラー"}`);
  }
}

/**
 * getUserMedia 互換処理
 * @param {MediaStreamConstraints} constraints
 */
function getCompatibleUserMedia(constraints) {
  // セキュアコンテキスト（HTTPS / localhost）の先行検証
  if (!window.isSecureContext) {
    const secErr = new Error(
      "非セキュア環境 (HTTP) のためカメラがブロックされています。HTTPS (https://...) でアクセスしてください。"
    );
    secErr.name = "SecurityError";
    throw secErr;
  }

  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function") {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  const legacyGetUserMedia =
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia ||
    navigator.msGetUserMedia;

  if (legacyGetUserMedia) {
    return new Promise((resolve, reject) => {
      legacyGetUserMedia.call(navigator, constraints, resolve, reject);
    });
  }

  const notSupportedErr = new Error("このブラウザはカメラAPIに対応していません。");
  notSupportedErr.name = "NotSupportedError";
  throw notSupportedErr;
}

/**
 * インカメラ（フロントカメラ）の自動起動
 */
async function startFrontCamera() {
  let stream = null;

  // 16:9比率を維持しつつ、画質よりもフレームレート（60fps）と低遅延（低負荷）を最優先する制約リスト
  // 720p等の高解像度は推論負荷・描画ピクセル数が増大しfps低下を招くため後回しとし、540p/360pを最優先探索
  const tryConstraints = [
    // 1. 540p (960x540, 16:9) 60fps志向（画質と軽量性の最良バランス）
    {
      video: {
        facingMode: "user",
        width: { ideal: 960 },
        height: { ideal: 540 },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 60 }
      },
      audio: false
    },
    // 2. 360p (640x360, 16:9) 60fps志向（超軽量・最高レスポンス重視）
    {
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 360 },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 60 }
      },
      audio: false
    },
    // 3. 360p (640x360, 16:9) 任意fps（低解像度・軽量最優先）
    {
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 360 },
        aspectRatio: { ideal: 16 / 9 }
      },
      audio: false
    },
    // 4. 540p (960x540, 16:9) 任意fps
    {
      video: {
        facingMode: "user",
        width: { ideal: 960 },
        height: { ideal: 540 },
        aspectRatio: { ideal: 16 / 9 }
      },
      audio: false
    },
    // 5. 720p (1280x720, 16:9) 60fps志向（後回しフォールバック）
    {
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 60 }
      },
      audio: false
    },
    // 6. インカメラ指定のみ（解像度・比率不問）
    {
      video: {
        facingMode: "user"
      },
      audio: false
    },
    // 7. 最終フォールバック（ハードウェアが返せる任意のビデオ）
    {
      video: true,
      audio: false
    }
  ];

  let lastError = null;
  for (const constraints of tryConstraints) {
    try {
      stream = await getCompatibleUserMedia(constraints);
      if (stream) break;
    } catch (e) {
      lastError = e;
      // ユーザーによる権限拒否やセキュアコンテキスト違反は制約変更で解決しないため即座にスロー
      if (
        e.name === "NotAllowedError" ||
        e.name === "PermissionDeniedError" ||
        e.name === "SecurityError"
      ) {
        throw e;
      }
      console.warn("制約でのカメラ起動失敗、次を試行:", e);
    }
  }

  if (!stream) {
    throw lastError || new Error("インカメラの取得に失敗しました。カメラのアクセス許可を確認してください。");
  }

  currentStream = stream;
  video.srcObject = currentStream;

  // ハードウェアがサポートする最大フレームレートの適用を試みる（iOS Safariなど非対応環境では安全にスキップ）
  const track = stream.getVideoTracks()[0];
  if (track) {
    try {
      if (typeof track.getCapabilities === "function") {
        const caps = track.getCapabilities();
        console.log("[CAM CAPABILITIES]", caps);
        const targetFps = caps.frameRate && caps.frameRate.max ? Math.min(60, caps.frameRate.max) : 60;
        if (typeof track.applyConstraints === "function") {
          await track.applyConstraints({
            frameRate: { ideal: targetFps }
          });
        }
      }
    } catch (err) {
      console.warn("FPS制約適用スキップ（端末非対応または制約適用不可）:", err);
    }

    // 実効カメラ設定（解像度・fps）をHUDに反映
    try {
      if (typeof track.getSettings === "function") {
        const settings = track.getSettings();
        const fpsLabel = settings.frameRate ? `${Math.round(settings.frameRate)}fps` : "60fps";
        const resLabel = settings.height ? `${settings.height}p` : "-";
        if (camInfo) {
          camInfo.textContent = `FRONT (${resLabel} ${fpsLabel})`.trim();
        }
      }
    } catch (settingErr) {
      console.warn("カメラ設定取得スキップ:", settingErr);
    }
  }

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = async () => {
      try {
        await video.play();
        resolve();
      } catch (playErr) {
        console.warn("[CAM] video.play() 自動再生エラー:", playErr);
        // 自動再生ポリシー制限（NotAllowedError や User interaction 必須）の場合はタップ起動フォールバックを要求
        const isAutoplayBlocked =
          playErr.name === "NotAllowedError" ||
          playErr.name === "AbortError" ||
          (playErr.message && playErr.message.toLowerCase().includes("interact"));

        if (isAutoplayBlocked) {
          const autoErr = new Error("画面をタップしてカメラを開始してください");
          autoErr.name = "AutoplayBlockedError";
          reject(autoErr);
          return;
        }
        reject(playErr);
      }
    };
    video.onerror = (err) => reject(err);
  });

  // Canvas内部解像度をビデオ解像度に完全一致させる
  updateCanvasResolution();

  // 推論ループ開始
  isPredicting = true;
  schedulePredictLoop();

  updateStatus("トラッキング中");
}

/**
 * Canvas内部解像度をビデオのネイティブピクセル数に同期
 */
function updateCanvasResolution() {
  if (video.videoWidth && video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

let lastVideoTimestamp = -1;

/**
 * 毎フレームの推論処理（単一フレーム）
 * @param {number} frameTime
 */
function processVideoFrame(frameTime) {
  if (!isPredicting) return;

  // 正確なフレーム時間をミリ秒で算出（MediaPipe VIDEOモードが要求する厳密な単調増加を保証）
  const now = typeof frameTime === "number" ? frameTime : performance.now();
  const timestampMs = Math.max(now, lastVideoTimestamp + 1.0);
  lastVideoTimestamp = timestampMs;

  const startTime = performance.now();

  // VIDEOモードでの同期推論（正確なタイムスタンプにより内部トラッキング予測器が安定化）
  const results = handLandmarker.detectForVideo(video, timestampMs);

  const calcDuration = performance.now() - startTime;
  if (isDebugPanelVisible) {
    inferenceTime.textContent = `${calcDuration.toFixed(1)} ms`;
  }

  // 生ランドマーク座標の直接描画
  drawRawHandLandmarks(results);

  // FPS更新
  updateFps();
}

/**
 * requestVideoFrameCallback または requestAnimationFrame による推論ループ
 * （カメラの物理フレーム到着に直接同期して60fpsを安定維持）
 */
function schedulePredictLoop() {
  if (!isPredicting) return;

  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    video.requestVideoFrameCallback((now, metadata) => {
      const frameTime = (metadata && metadata.presentationTime) ? metadata.presentationTime * 1000 : now;
      processVideoFrame(frameTime);
      schedulePredictLoop();
    });
  } else {
    requestAnimationFrame((now) => {
      if (video.currentTime !== lastVideoTime && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        lastVideoTime = video.currentTime;
        processVideoFrame(now);
      }
      schedulePredictLoop();
    });
  }
}

// 追従時の最大許容移動距離（正規化座標系：画面幅の25%）
// 1フレーム（約16ms）で右手手首がこれ以上離れることは物理的にあり得ないため、左手への飛び移りを完全遮断
const MAX_WRIST_TRACK_DISTANCE = 0.25;

// ナックル外積の明確な判定閾値（ゼロ近傍の不感帯用）
const CROSS_RIGHT_THRESHOLD = -0.002;
const CROSS_LEFT_THRESHOLD = 0.002;

// 画面左端のセーフティ境界（生カメラ画像で x < 0.02 等の極端な欠損フレームのみ除外）
const MIN_SAFETY_X = 0.02;

/**
 * 手のひらナックルの幾何学的向き（2Dベクトル外積）による右手判定（ヒステリシス対応）
 * 手首(0)→人差し指付け根(5) と 手首(0)→小指付け根(17) の外積を計算
 * 生カメラ画像（CSS scaleX(-1)反転前）において、手の甲が上（机面打鍵姿勢）の場合：
 * - 物理的な右手: 人差し指(5)が右(+X)、小指(17)が左(-X) → cross < 0
 * - 物理的な左手: 人差し指(5)が左(-X)、小指(17)が右(+X) → cross > 0
 * @param {Array<object>} hand 手の全21ランドマーク配列
 * @param {boolean} isCurrentlyTracked 現在追従中の右手候補（位置が近い）かどうか
 * @returns {boolean} 物理的な右手であれば true、左手であれば false
 */
function isAnatomicallyRightHand(hand, isCurrentlyTracked = false) {
  if (!hand || hand.length < 21) return false;

  const p0 = hand[0];   // 手首 (WRIST)
  const p5 = hand[5];   // 人差し指付け根 (INDEX_FINGER_MCP)
  const p17 = hand[17]; // 小指付け根 (PINKY_MCP)

  const vIndexX = p5.x - p0.x;
  const vIndexY = p5.y - p0.y;
  const vPinkyX = p17.x - p0.x;
  const vPinkyY = p17.y - p0.y;

  // 2D外積（Cross Product）
  const cross = vIndexX * vPinkyY - vIndexY * vPinkyX;

  // 明確に右手（人差し指が右、小指が左）
  if (cross < CROSS_RIGHT_THRESHOLD) {
    return true;
  }
  // 明確に左手（人差し指が左、小指が右）
  if (cross > CROSS_LEFT_THRESHOLD) {
    return false;
  }

  // ゼロ近傍の不感帯（ローアングルでの揺らぎ）：
  // 現在追従中の右手（前回の右手位置に近い）であれば、打鍵時の指屈伸によるブレとみなして右手判定を維持
  if (isCurrentlyTracked) {
    return true;
  }

  // 未追従時のゼロ近傍は、負側であれば右手候補として扱う
  return cross < 0;
}

/**
 * 位置連続性（Nearest-Neighbor）とナックル外積ヒステリシスに基づく右手セレクター
 * - 追従中は候補数に関わらず画面幅25%以上の距離ジャンプを無条件遮断（左手飛び移り防止）
 * - ナックル外積のヒステリシスにより、ローアングル打鍵時のチャタリング（判定点滅）を解消
 * - 右手が画面から消えた場合は左手に乗り換えず、右手が戻るまで待機（null返却）
 * @param {object} results MediaPipe HandLandmarkerの検出結果
 * @returns {Array<object> | null} 追従対象の右手の全21ランドマーク配列（未検出時はnull）
 */
function selectRightHandLandmarks(results) {
  if (!results || !results.landmarks || results.landmarks.length === 0) {
    return null;
  }

  const hands = results.landmarks;

  // ========================================================
  // 1. 追従中（lastTrackedWrist が存在する場合）：
  // ========================================================
  if (lastTrackedWrist) {
    // 検出された全手の中から、前回の右手位置に最も近い手を探す
    let closestHand = hands[0];
    let minDistance = Infinity;

    for (let i = 0; i < hands.length; i++) {
      const hand = hands[i];
      const wrist = hand[0];
      const dist = Math.hypot(wrist.x - lastTrackedWrist.x, wrist.y - lastTrackedWrist.y);
      if (dist < minDistance) {
        minDistance = dist;
        closestHand = hand;
      }
    }

    // 【要件1: 距離リミッターの無条件適用】
    // 候補数に関わらず、前回の右手位置から画面幅25%以上離れている手は絶対に採用しない（左手へのワープを100%遮断）
    if (minDistance > MAX_WRIST_TRACK_DISTANCE) {
      return null;
    }

    // 最も近い手が右手であるかナックル幾何判定（追従中ヒステリシス有効）
    // （前回の右手位置の至近にある手であっても、明確に左手形状をしている場合は除外）
    if (!isAnatomicallyRightHand(closestHand, true)) {
      return null;
    }

    // 画面端スレスレの欠損セーフティ
    if (closestHand[0].x < MIN_SAFETY_X) {
      return null;
    }

    return closestHand;
  }

  // ========================================================
  // 2. 未追従状態（初回出現時または完全ロスト後の初回復帰時）：
  // ========================================================
  // ナックル外積により物理的な右手と判定される候補のみを抽出（左手はここで100%除外）
  const rightCandidates = hands.filter((hand) => {
    if (!isAnatomicallyRightHand(hand, false)) return false;
    if (hand[0].x < MIN_SAFETY_X) return false;
    return true;
  });

  if (rightCandidates.length === 0) {
    return null;
  }

  // 右手候補が1つの場合はそれを採用
  if (rightCandidates.length === 1) {
    return rightCandidates[0];
  }

  // 複数候補がある場合は、生カメラ画像で最も左側（x座標が最小＝正面カメラにおける右手側）を選択
  let leftmostHand = rightCandidates[0];
  let minX = Infinity;

  for (let i = 0; i < rightCandidates.length; i++) {
    const hand = rightCandidates[i];
    const wrist = hand[0];
    if (wrist.x < minX) {
      minX = wrist.x;
      leftmostHand = hand;
    }
  }

  return leftmostHand;
}

/**
 * 手の全21ランドマークの適応平滑化描画、打鍵・リフト用特徴量の算出
 * 手首・手のひら・全指先を独立した 1 Euro Filter で常時平滑化し、ジッターと飛びを完全排除
 * @param {object} results
 */
function drawRawHandLandmarks(results) {
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

  const fingerConfig = FINGER_CONFIGS[currentFingerKey] || FINGER_CONFIGS.THUMB;
  const targetIndices = fingerConfig.indices;
  const width = canvas.width;
  const height = canvas.height;
  const now = performance.now();

  // 位置連続性による右手セレクターを実行（左手は完全除外）
  const selectedRightHand = selectRightHandLandmarks(results);
  const hasHands = selectedRightHand !== null;

  if (!hasHands) {
    lostFrames++;
    // 3フレーム以内（約50ms）の一時的ロストであれば直前の平滑化座標で描画を維持し、画面の点滅・ジャンプを防止
    if (lostFrames <= MAX_LOST_FRAMES && hasValidSmoothedLandmarks) {
      // 直前フレームの平滑化座標でフィルターを現在タイムスタンプ（now）で空回し更新し、復帰時のdt拡大による速度微分スパイクを防止
      for (let i = 0; i < 21; i++) {
        const pt = smoothedLandmarksPool[i];
        landmarkFilters[i].filter(pt.x, pt.y, now, pt);
      }
    } else {
      if (isDebugPanelVisible) {
        handsCount.textContent = "0";
      }
      if (tapState !== "IDLE") {
        tapState = "IDLE";
        updateStateHud("IDLE", false);
      }
      // 完全に画角から外れた場合のみフィルターと追従位置をリセット
      landmarkFilters.forEach((f) => f.reset());
      hasValidSmoothedLandmarks = false;
      lastRawLandmarks = null;
      lastTrackedWrist = null; // ★完全ロスト時は右手トラッキング位置もリセット
      resetDebugMetrics();
      updateAndDrawTapEffects(canvasCtx);
      return;
    }
  } else {
    lostFrames = 0;
  }

  if (isDebugPanelVisible) {
    const totalDetected = results && results.landmarks ? results.landmarks.length : 0;
    handsCount.textContent = hasHands ? `${totalDetected} (右手ロック)` : "1 (補間)";
  }

  // 画面外（完全未検出状態）からの再出現初フレームかどうかを判定
  const isReacquired = hasHands && !hasValidSmoothedLandmarks;

  // メインの手のランドマーク生座標（右手セレクターで選択された右手のみを供給・左手データは完全破棄）
  const landmarks = hasHands ? selectedRightHand : lastRawLandmarks;
  if (!landmarks) return;
  lastRawLandmarks = landmarks;

  // 追従中の右手手首の生正規化座標で lastTrackedWrist を毎フレーム更新
  lastTrackedWrist = { x: landmarks[0].x, y: landmarks[0].y };

  // 全21関節点の独立平滑化（オブジェクトプールを再利用して毎フレームの新規生成・破棄によるGCスパイクを完全排除）
  if (hasHands) {
    if (isReacquired) {
      // 画面外復帰初フレーム：過去の古い座標からの引きずりをバイパスし、今回検出された新座標で即座にスナップ初期化
      for (let i = 0; i < 21; i++) {
        const raw = landmarks[i];
        landmarkFilters[i].snap(raw.x * width, raw.y * height, now, smoothedLandmarksPool[i]);
      }
    } else {
      // 通常トラッキング時：適応平滑化（1 Euro Filter）
      for (let i = 0; i < 21; i++) {
        const raw = landmarks[i];
        landmarkFilters[i].filter(raw.x * width, raw.y * height, now, smoothedLandmarksPool[i]);
      }
    }
    hasValidSmoothedLandmarks = true;
  }
  const smoothedLandmarks = smoothedLandmarksPool;

  // 1. 対象指以外の骨格・関節点描画は非表示（視覚ノイズ排除および描画負荷削減）

  // 2. 選択中指の平滑化ピクセル座標
  const smoothP1 = smoothedLandmarks[fingerConfig.p1Idx];
  const smoothP2 = smoothedLandmarks[fingerConfig.p2Idx];
  const smoothP3 = smoothedLandmarks[fingerConfig.p3Idx];
  const smoothTip = smoothedLandmarks[fingerConfig.tipIdx];

  // 最新平滑化座標の保持
  currentTip.x = smoothTip.x;
  currentTip.y = smoothTip.y;

  // 手首（Landmark 0: Wrist）と対象指の付け根（baseIdx）間の平滑化2Dピクセル距離（手の基準長）
  // ※生のlandmarksやジッターの大きいz深度を完全撤去し、平滑化済み2D座標のみを用いて算出
  const smoothWrist = smoothedLandmarks[0];
  const smoothBaseLm = smoothedLandmarks[fingerConfig.baseIdx];
  const baseDistPx = Math.hypot(smoothBaseLm.x - smoothWrist.x, smoothBaseLm.y - smoothWrist.y);
  // 画面高の5%を下回らないよう安全最小値を設定して分母微小化スパイクを防止
  const safeBaseDistPx = Math.max(baseDistPx, height * 0.05);

  // 対象指の基準点ピクセル座標（smoothP2 または smoothP1）
  const smoothBase = (fingerConfig.baseIdx === fingerConfig.p1Idx) ? smoothP1 : smoothP2;

  // 完全平滑化・2Dピクセル比に基づく安定した相対変位 ry
  const currentRy = (smoothTip.y - smoothBase.y) / safeBaseDistPx;

  // 現在のターゲット音符とハイライト色（単発＝水色、連続＝黄色→緑色→青色）
  const targetColor = getTargetFingerColor(currentSongStep);

  // 3. 学習済みCSVモデルによるリアルタイム打鍵認識（空中誤検知を遮断）
  // カウントダウン中（3・2・1）、完走クリア演出中、および画面外復帰初フレームは打鍵認識を安全にスキップ
  if (tapState === "IDLE" && !isCountingDown && !isClearing && !isReacquired) {
    // 平滑化変位が学習された打鍵閾値以上になったら打鍵判定
    if (currentRy >= hitRyThreshold) {
      tapState = "TOUCHED";

      // 現在の音符を取得
      const currentTarget = currentSequence[currentSongStep];

      // 右手正解メロディ音を発音
      playTapSound(currentTarget.rightNote || currentTarget.freq, true);

      // 自動伴奏（和音・左手パート）を重ねて発音（プレイヤーの打鍵操作は不要）
      playAccompaniment(currentTarget);
      updateStateHud("TOUCHED", true);

      console.log(
        `[SONG HIT] [${SONGS[currentSongId]?.title || ""}] Step ${currentTarget.step}/${currentSequence.length} [右手打鍵] 運指:${currentTarget.fingerNum} (${currentTarget.note}) 色:${targetColor.name} ry=${currentRy.toFixed(3)} >= TH:${hitRyThreshold.toFixed(2)}${currentTarget.autoChord ? ` [自動伴奏: ${currentTarget.autoChord.join("+")}]` : currentTarget.autoLeftNote ? ` [自動伴奏: ${currentTarget.autoLeftNote}]` : ""}`
      );

      // 打鍵直前の指先座標を記録
      const fromTipX = smoothTip.x;
      const fromTipY = smoothTip.y;

      const isLastStep = currentSongStep === currentSequence.length - 1;

      if (isLastStep) {
        // 完走時：白黒ミニマルクリア通知（約1.5秒間）を表示後、インデックス0（第1音）へ自動ループ復帰
        console.log(`[SONG COMPLETE] 全${currentSequence.length}音を完走！クリア通知を表示します`);
        showClearNotification(() => {
          currentSongStep = 0;
          resetAccompaniment();
          const resetTarget = currentSequence[0];
          setTargetFinger(resetTarget.fingerKey);
          renderSongGuideUI();
          console.log(`[SONG LOOP] 第1音 (${resetTarget.note} / ${resetTarget.fingerKey}) へリセット完了`);
        });
      } else {
        // 通常進行：次の音符へステップ進行
        currentSongStep = currentSongStep + 1;
        const nextTarget = currentSequence[currentSongStep];
        const nextColor = getTargetFingerColor(currentSongStep);

        // 次の指先座標（全点平滑化済み座標から取得してブレ・飛びをゼロに）
        const nextFingerCfg = FINGER_CONFIGS[nextTarget.fingerKey] || fingerConfig;
        const nextSmoothTip = smoothedLandmarks[nextFingerCfg.tipIdx];
        const toTipX = nextSmoothTip ? nextSmoothTip.x : fromTipX;
        const toTipY = nextSmoothTip ? nextSmoothTip.y : fromTipY;

        // 次の指先へ飛んでいく光のラインエフェクト（彗星ビーム）を生成！
        spawnBeamEffect(fromTipX, fromTipY, toTipX, toTipY, nextColor);

        // 次のターゲット指へ自動切り替えとガイド更新
        setTargetFinger(nextTarget.fingerKey);
        renderSongGuideUI();
      }
    }
  } else if (tapState === "TOUCHED") {
    // 指のリフト復帰（閾値を下回ったら待機状態へ）
    if (currentRy <= liftRyThreshold) {
      tapState = "IDLE";
      updateStateHud("IDLE", false);
    }
  }

  // 4. デバッグHUDのリアルタイム表示更新（平滑化座標と相対変位）
  updateDebugMetrics(smoothTip.x, smoothTip.y, currentRy);

  // 5. 指定された指の骨格描画（shadowBlurを撤去し、多層ストロークで高速・高鮮明に描画）
  canvasCtx.save();
  canvasCtx.lineCap = "round";
  canvasCtx.lineJoin = "round";

  // 共通骨格パス生成
  const drawBonePath = () => {
    canvasCtx.beginPath();
    canvasCtx.moveTo(smoothP1.x, smoothP1.y);
    canvasCtx.lineTo(smoothP2.x, smoothP2.y);
    canvasCtx.lineTo(smoothP3.x, smoothP3.y);
    canvasCtx.lineTo(smoothTip.x, smoothTip.y);
  };

  // 層1: 外側発光ハローライン（太さ 12px、半透明カラーでブラー相当のグロー感を表現）
  canvasCtx.strokeStyle = targetColor.halo || "rgba(0, 229, 255, 0.25)";
  canvasCtx.lineWidth = 12.0;
  drawBonePath();
  canvasCtx.stroke();

  // 層2: 中間メインネオンライン（太さ 6.0px、高彩度ネオンカラー）
  canvasCtx.strokeStyle = targetColor.stroke;
  canvasCtx.lineWidth = 6.0;
  drawBonePath();
  canvasCtx.stroke();

  // 層3: 内側高輝度ホワイトコアライン（太さ 2.4px：芯が白く発光して立体感・視認性を極大化）
  canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  canvasCtx.lineWidth = 2.4;
  drawBonePath();
  canvasCtx.stroke();

  // 対象指関節点（P1, P2, P3）の多層描画（外側ハロー＋メイン＋白コア）
  [smoothP1, smoothP2, smoothP3].forEach((pt) => {
    // 層1: 外側ハロー
    canvasCtx.beginPath();
    canvasCtx.arc(pt.x, pt.y, 8.0, 0, 2 * Math.PI);
    canvasCtx.fillStyle = targetColor.halo || "rgba(0, 229, 255, 0.25)";
    canvasCtx.fill();

    // 層2: メインカラードット
    canvasCtx.beginPath();
    canvasCtx.arc(pt.x, pt.y, 5.0, 0, 2 * Math.PI);
    canvasCtx.fillStyle = targetColor.fill;
    canvasCtx.fill();

    // 層3: 内側白熱コア
    canvasCtx.beginPath();
    canvasCtx.arc(pt.x, pt.y, 2.4, 0, 2 * Math.PI);
    canvasCtx.fillStyle = "#ffffff";
    canvasCtx.fill();
  });

  // 6. 対象指先端（TIP）のハイライトターゲット描画（多層発光リング＋白熱コア）
  drawTipTargetMark(smoothTip.x, smoothTip.y, targetColor);
  canvasCtx.restore();

  // 7. 演奏時エフェクト（彗星ビーム）のアニメーション更新・描画
  updateAndDrawTapEffects(canvasCtx);
}

/**
 * 対象指先端（TIP）のターゲットマーク描画（shadowBlur全廃・多層二重発光リング＋白熱コア）
 * @param {number} x
 * @param {number} y
 * @param {object} color
 */
function drawTipTargetMark(x, y, color) {
  const strokeColor = color?.stroke || "rgba(0, 229, 255, 0.95)";
  const haloColor = color?.halo || "rgba(0, 229, 255, 0.25)";
  const accentColor = color?.accent || "rgba(0, 229, 255, 0.65)";
  const fillColor = color?.fill || "#00e5ff";

  canvasCtx.save();

  // 外側の極太発光メインリング（多層化：太ハロー＋鮮明コア線）
  // 層1: 外側発光ハローリング（半径13px、線幅 7.5px）
  canvasCtx.beginPath();
  canvasCtx.arc(x, y, 13, 0, 2 * Math.PI);
  canvasCtx.strokeStyle = haloColor;
  canvasCtx.lineWidth = 7.5;
  canvasCtx.stroke();

  // 層2: 外側メインリング（半径13px、線幅 2.8px）
  canvasCtx.beginPath();
  canvasCtx.arc(x, y, 13, 0, 2 * Math.PI);
  canvasCtx.strokeStyle = strokeColor;
  canvasCtx.lineWidth = 2.8;
  canvasCtx.stroke();

  // 内側の補助リング（半径8px、線幅 1.8px、事前計算accentColorで正規表現全廃）
  canvasCtx.beginPath();
  canvasCtx.arc(x, y, 8, 0, 2 * Math.PI);
  canvasCtx.strokeStyle = accentColor;
  canvasCtx.lineWidth = 1.8;
  canvasCtx.stroke();

  // 中心発光ドット（多層描画: 外輪ハロー 半径 7.0px + メイン 半径 4.6px + 白熱コア 半径 2.4px）
  canvasCtx.beginPath();
  canvasCtx.arc(x, y, 7.0, 0, 2 * Math.PI);
  canvasCtx.fillStyle = haloColor;
  canvasCtx.fill();

  canvasCtx.beginPath();
  canvasCtx.arc(x, y, 4.6, 0, 2 * Math.PI);
  canvasCtx.fillStyle = fillColor;
  canvasCtx.fill();

  canvasCtx.beginPath();
  canvasCtx.arc(x, y, 2.4, 0, 2 * Math.PI);
  canvasCtx.fillStyle = "#ffffff";
  canvasCtx.fill();

  canvasCtx.restore();
}

/**
 * 人差し指TIPの生座標（X, Y）および相対変位のHUD更新表示（白黒ミニマル）
 * @param {number} x
 * @param {number} y
 * @param {number} ry
 */
function updateDebugMetrics(x, y, ry) {
  if (!isDebugPanelVisible) return;
  tipXVal.textContent = `${x.toFixed(1)}px`;
  tipYVal.textContent = `${y.toFixed(1)}px`;
  if (relYVal) {
    relYVal.textContent = ry !== undefined && ry !== null ? (ry >= 0 ? `+${ry.toFixed(2)}` : ry.toFixed(2)) : "-";
  }
}

/**
 * 手ロスト時のHUDメトリクスリセット
 */
function resetDebugMetrics() {
  if (!isDebugPanelVisible) return;
  tipXVal.textContent = "-";
  tipYVal.textContent = "-";
  if (relYVal) {
    relYVal.textContent = "-";
  }
}

/**
 * 打鍵ステート（IDLE / TOUCHED）のHUD更新と打鍵時ハイライト
 * @param {string} state
 * @param {boolean} isHitFlash
 */
function updateStateHud(state, isHitFlash) {
  if (!stateVal) return;
  stateVal.textContent = state;
  if (isHitFlash) {
    stateVal.classList.add("spike-highlight");
    setTimeout(() => {
      if (stateVal && tapState === "TOUCHED") {
        stateVal.classList.remove("spike-highlight");
      }
    }, 120);
  } else {
    stateVal.classList.remove("spike-highlight");
  }
}

/**
 * FPSカウンターの計算
 */
function updateFps() {
  frameCount++;
  const now = performance.now();
  const elapsed = now - lastFpsUpdateTime;

  if (elapsed >= 500) {
    checkDebugPanelVisibility();
    if (isDebugPanelVisible) {
      const fps = ((frameCount * 1000) / elapsed).toFixed(1);
      fpsCounter.textContent = fps;
    }
    frameCount = 0;
    lastFpsUpdateTime = now;
  }
}

/**
 * ステータス表示の更新
 */
function updateStatus(msg) {
  statusText.textContent = msg;
}

/**
 * カメラエラーの種別に応じたユーザー向けガイダンス文言を生成
 * @param {Error|DOMException} error
 * @returns {string}
 */
function getCameraErrorMessage(error) {
  if (!window.isSecureContext || !navigator.mediaDevices) {
    return "カメラはHTTPS環境でのみ動作します。https:// または localhost でアクセスしてください。";
  }

  const errName = error?.name || "";
  const errMsg = error?.message || "";

  if (
    errName === "NotAllowedError" ||
    errName === "PermissionDeniedError" ||
    errMsg.includes("許可") ||
    errMsg.includes("NotAllowed")
  ) {
    return "カメラの利用が許可されていません。ブラウザのアドレスバーまたは端末の『設定』からカメラを許可し、ページを再読み込みしてください。";
  }

  if (
    errName === "NotReadableError" ||
    errName === "TrackStartError" ||
    errMsg.includes("使用中") ||
    errMsg.includes("NotReadable")
  ) {
    return "カメラを起動できませんでした。他のアプリ（通話・カメラ等）が使用中の可能性があります。他アプリを終了して再読み込みしてください。";
  }

  if (
    errName === "OverconstrainedError" ||
    errName === "ConstraintNotSatisfiedError"
  ) {
    return "カメラの初期化に失敗しました。標準設定で再試行します。";
  }

  return "カメラの初期化に失敗しました。標準設定で再試行します。";
}

/**
 * カメラエラー・ガイダンス通知オーバーレイの表示（白黒ミニマル）
 * @param {string} message
 * @param {string} [title]
 */
function showCameraErrorOverlay(message, title = "カメラを起動できません") {
  if (cameraErrorTitle) cameraErrorTitle.textContent = title;
  if (cameraErrorMessage) cameraErrorMessage.textContent = message;
  if (cameraErrorOverlay) {
    cameraErrorOverlay.classList.remove("hidden");
  }
}

/**
 * エラー表示（デバッグパネル用）
 */
function showError(msg) {
  if (errorBox) {
    errorBox.textContent = `ERROR: ${msg}`;
    errorBox.classList.remove("hidden");
  }
}

// カメラエラーオーバーレイのボタンハンドラ
if (cameraErrorReloadBtn) {
  cameraErrorReloadBtn.addEventListener("click", () => {
    window.location.reload();
  });
}
if (cameraErrorCloseBtn) {
  cameraErrorCloseBtn.addEventListener("click", () => {
    if (cameraErrorOverlay) {
      cameraErrorOverlay.classList.add("hidden");
    }
  });
}

/**
 * アプリ内ブラウザ（WebView）の検出
 * @returns {{ isInApp: boolean, isLine: boolean, appName: string }}
 */
function detectInAppBrowser() {
  const ua = (navigator.userAgent || navigator.vendor || window.opera || "").toLowerCase();
  const isLine = ua.includes("line/");
  const isTwitter = ua.includes("twitter") || ua.includes("tweetie");
  const isInstagram = ua.includes("instagram");
  const isFacebook = ua.includes("fb_iab") || ua.includes("fb4a") || ua.includes("fbios");
  const isTikTok = ua.includes("musical_ly") || ua.includes("bytelocale");

  let appName = "";
  if (isLine) appName = "LINE";
  else if (isTwitter) appName = "X (Twitter)";
  else if (isInstagram) appName = "Instagram";
  else if (isFacebook) appName = "Facebook";
  else if (isTikTok) appName = "TikTok";

  return {
    isInApp: Boolean(appName),
    isLine,
    appName: appName || "アプリ内ブラウザ"
  };
}

/**
 * アプリ内ブラウザ誘導モーダルの表示（白黒ミニマル）
 * @param {{ isInApp: boolean, isLine: boolean, appName: string }} inAppInfo
 * @param {() => void} [onContinue]
 */
function showInAppBrowserModal(inAppInfo, onContinue) {
  if (!inappBrowserModal) return;

  if (inappBrowserBadge) {
    inappBrowserBadge.textContent = `${inAppInfo.appName.toUpperCase()} DETECTED`;
  }
  if (inappBrowserDesc) {
    inappBrowserDesc.innerHTML = `<strong>${inAppInfo.appName}</strong> のアプリ内ブラウザでは、セキュリティ制限によりカメラが動作しない場合があります。<br />Safari（iOS）または Chrome（Android）の標準ブラウザでお試しください。`;
  }

  // LINE環境の場合は外部ブラウザで直接開くURLパラメータ（?openExternalBrowser=1）を設定
  if (inAppInfo.isLine && inappOpenExternalBtn) {
    const url = new URL(window.location.href);
    url.searchParams.set("openExternalBrowser", "1");
    inappOpenExternalBtn.href = url.toString();
    inappOpenExternalBtn.classList.remove("hidden");
  }

  // URLコピーボタン
  if (inappCopyUrlBtn) {
    inappCopyUrlBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        showCopyToast();
      } catch {
        const dummy = document.createElement("input");
        dummy.value = window.location.href;
        document.body.appendChild(dummy);
        dummy.select();
        document.execCommand("copy");
        document.body.removeChild(dummy);
        showCopyToast();
      }
    };
  }

  // このまま試すボタン
  if (inappContinueBtn) {
    inappContinueBtn.onclick = () => {
      inappBrowserModal.classList.add("hidden");
      if (typeof onContinue === "function") {
        onContinue();
      }
    };
  }

  inappBrowserModal.classList.remove("hidden");
}

/**
 * コピー完了トーストの表示
 */
function showCopyToast() {
  if (!inappCopyToast) return;
  inappCopyToast.classList.remove("hidden");
  setTimeout(() => {
    inappCopyToast.classList.add("hidden");
  }, 2500);
}

let tapPromptCallback = null;

/**
 * タップ起動フォールバックプロンプトの表示（白黒ミニマル）
 * @param {() => Promise<void>} onTap
 */
function showCameraTapPrompt(onTap) {
  tapPromptCallback = onTap;
  if (cameraTapPrompt) {
    cameraTapPrompt.classList.remove("hidden");
  }
}

/**
 * タップ起動フォールバックプロンプトの非表示
 */
function hideCameraTapPrompt() {
  tapPromptCallback = null;
  if (cameraTapPrompt) {
    cameraTapPrompt.classList.add("hidden");
  }
}

// タップ起動ボタンのハンドラ
if (cameraTapBtn) {
  cameraTapBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    ensureAudioContext();
    if (typeof tapPromptCallback === "function") {
      const cb = tapPromptCallback;
      hideCameraTapPrompt();
      await cb();
    }
  });
}

// 解像度同期イベント
video.addEventListener("resize", updateCanvasResolution);
window.addEventListener("resize", updateCanvasResolution);

// DOM読み込み完了時に自動実行（既に完了している場合は即時実行）
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// ブラウザのAutoplay Policy対応（初回クリックまたはタップでAudioContextを確実にresume）
["pointerdown", "touchstart", "click", "keydown"].forEach((evt) => {
  window.addEventListener(evt, ensureAudioContext, { once: false, passive: true });
});

// TEST SOUNDボタン押下時の手動テスト発音
if (testSoundBtn) {
  testSoundBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    ensureAudioContext();
    playTapSound(587.33); // D5トーンでテスト発音
    console.log("[AUDIO] TEST SOUND 発音");
  });
}

// 手元CSVファイルの手動追加インプット (+FILE)
if (csvFileInput) {
  csvFileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const loadedList = [];
    for (const file of files) {
      const text = await file.text();
      loadedList.push({ name: file.name, content: text });
    }

    ingestCsvFiles(loadedList);
    csvFileInput.value = ""; // 連続選択可能にするためリセット
  });
}

// 画面右上の丸い楽曲選択ボタンとメニュー
const songSelectBtn = document.getElementById("song-select-btn");
const songSelectMenu = document.getElementById("song-select-menu");

if (songSelectBtn && songSelectMenu) {
  // 丸ボタンタップでメニュー表示/非表示トグル
  songSelectBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    ensureAudioContext(); // ユーザー操作契機でオーディオ初期化
    songSelectMenu.classList.toggle("hidden");
  });

  // メニュー項目タップで曲選択
  document.querySelectorAll(".song-menu-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      ensureAudioContext();
      const songId = item.dataset.song;
      if (songId) {
        selectSong(songId);
      }
    });
  });

  // 画面外タップでメニューを閉じる
  document.addEventListener("click", (e) => {
    if (!songSelectMenu.classList.contains("hidden") && !songSelectMenu.contains(e.target)) {
      songSelectMenu.classList.add("hidden");
    }
  });
}

// 初回オーディオ開始バナーのクリックイベント
if (audioStartBanner) {
  audioStartBanner.addEventListener("click", () => {
    ensureAudioContext();
    playTapSound("E5", false); // E5トーンで確認発音（よろこびのうた 第1音と同じ）
  });
}

// 初期ターゲット指（よろこびのうた 第1音: 中指 3 ミ）の設定と楽曲ガイドUIの描画
setTargetFinger(currentSequence[0].fingerKey);
renderSongGuideUI();


