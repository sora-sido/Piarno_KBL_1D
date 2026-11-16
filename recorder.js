/**
 * 検証用データの録画（URL に ?record を付けたときだけ有効）
 *
 * 右手の全 21 ランドマークを毎フレーム記録し、停止時に CSV としてダウンロードする。
 * 録画した CSV は public/dataset/recordings/ に置くと tools/replay-dataset.mjs が再生検証に使う。
 *
 * これまでのデータセットは 1 本の指の指先・付け根・手首しか持たず、打鍵ラベルも判定ロジックの
 * 出力だったので、「隣の指との比較」や「接触の瞬間」を検証できなかった。そのため、
 *  - 5 本の指すべての座標（x, y, z）
 *  - マイクの音量（机を叩く音の立ち上がりを、判定とは独立した打鍵の目印にする）
 * を記録する。録画中はアプリの発音と打鍵判定を止める（マイクに音が入らないようにするため）。
 */

const KINDS = [
  ["tap", "打鍵（指定の指で机を叩く）"],
  ["neg_air", "空中で指を動かす"],
  ["neg_idle", "机に置いて静止"],
  ["neg_slide", "机の上で滑らせる"],
  ["neg_wrist", "手首を動かす"],
  ["neg_other", "ほかの指で叩く（指定の指は叩かない）"],
  ["free", "自由に演奏"]
];
const FINGERS = [
  ["THUMB", "親指"], ["INDEX", "人差し指"], ["MIDDLE", "中指"], ["RING", "薬指"], ["PINKY", "小指"], ["ALL", "指定なし"]
];

export const RECORDING_HEADER = [
  "t_ms", "has_hand", "hands_detected", "width", "height",
  "label_kind", "label_finger", "target_finger", "step", "mic_peak",
  ...Array.from({ length: 21 }, (_, i) => [`lm${i}_x`, `lm${i}_y`, `lm${i}_z`]).flat()
];

export class LandmarkRecorder {
  constructor() {
    this.enabled = typeof location !== "undefined" && new URLSearchParams(location.search).has("record");
    this.isRecording = false;
    this.lines = [];
    this.startedAt = 0;
    this.kind = "tap";
    this.finger = "MIDDLE";
    this.useMic = true;
    this.micContext = null;
    this.micStream = null;
    this.micAnalyser = null;
    this.micBuffer = null;
    this.ui = {};
  }

  /** 録画パネルを画面に追加（?record のときだけ） */
  mount(parent = document.body) {
    if (!this.enabled || this.ui.panel) return;
    const panel = document.createElement("div");
    panel.id = "record-panel";
    panel.style.cssText =
      "position:fixed;left:calc(12px + env(safe-area-inset-left,0px));top:calc(12px + env(safe-area-inset-top,0px));" +
      "z-index:500;display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid #555;border-radius:6px;" +
      "background:rgba(0,0,0,0.85);color:#eee;font:12px/1.4 -apple-system,'Segoe UI',sans-serif;min-width:200px;";

    const title = document.createElement("div");
    title.textContent = "検証用データの録画";
    title.style.cssText = "font-weight:700;letter-spacing:0.04em;";

    const kindSel = this.makeSelect("record-kind", KINDS, this.kind, (v) => (this.kind = v));
    const fingerSel = this.makeSelect("record-finger", FINGERS, this.finger, (v) => (this.finger = v));

    const micLabel = document.createElement("label");
    micLabel.style.cssText = "display:flex;align-items:center;gap:6px;";
    const mic = document.createElement("input");
    mic.type = "checkbox";
    mic.id = "record-mic";
    mic.checked = this.useMic;
    mic.addEventListener("change", () => (this.useMic = mic.checked));
    micLabel.append(mic, document.createTextNode("マイクで叩く音を記録"));

    const btn = document.createElement("button");
    btn.id = "record-toggle-btn";
    btn.textContent = "録画開始";
    btn.style.cssText =
      "padding:8px 10px;border:1px solid #fff;border-radius:4px;background:#fff;color:#000;font-weight:700;cursor:pointer;";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.isRecording) this.stop();
      else this.start();
    });

    const status = document.createElement("div");
    status.id = "record-status";
    status.textContent = "カメラ開始後に録画できます";
    status.style.cssText = "color:#aaa;font-variant-numeric:tabular-nums;";

    panel.append(title, kindSel, fingerSel, micLabel, btn, status);
    parent.appendChild(panel);
    this.ui = { panel, btn, status, kindSel, fingerSel, mic };
  }

  makeSelect(id, options, value, onChange) {
    const sel = document.createElement("select");
    sel.id = id;
    sel.style.cssText = "padding:5px;border:1px solid #555;border-radius:4px;background:#111;color:#eee;font:inherit;";
    for (const [v, label] of options) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      sel.appendChild(o);
    }
    sel.value = value;
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  /** 録画開始（マイクは使えなければ無しで続行） */
  async start() {
    if (this.isRecording) return;
    this.lines = [RECORDING_HEADER.join(",")];
    this.startedAt = performance.now();
    if (this.useMic) await this.openMic();
    this.isRecording = true;
    if (this.ui.btn) {
      this.ui.btn.textContent = "停止して保存";
      this.ui.kindSel.disabled = true;
      this.ui.fingerSel.disabled = true;
      this.ui.mic.disabled = true;
    }
  }

  async openMic() {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false
      });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.micContext = new Ctx();
      const src = this.micContext.createMediaStreamSource(this.micStream);
      this.micAnalyser = this.micContext.createAnalyser();
      this.micAnalyser.fftSize = 2048;
      this.micBuffer = new Float32Array(this.micAnalyser.fftSize);
      src.connect(this.micAnalyser); // 出力にはつながない（スピーカーから鳴らさない）
    } catch (err) {
      console.warn("[RECORD] マイクを使えないため、音量なしで録画します:", err);
      this.closeMic();
    }
  }

  closeMic() {
    if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    if (this.micContext) this.micContext.close().catch(() => {});
    this.micStream = null;
    this.micContext = null;
    this.micAnalyser = null;
    this.micBuffer = null;
  }

  /** 直近およそ 40ms のマイク波形の最大振幅（0〜1）。マイクなしなら空文字 */
  readMicPeak() {
    if (!this.micAnalyser) return "";
    this.micAnalyser.getFloatTimeDomainData(this.micBuffer);
    let peak = 0;
    for (let i = 0; i < this.micBuffer.length; i++) {
      const a = Math.abs(this.micBuffer[i]);
      if (a > peak) peak = a;
    }
    return peak.toFixed(4);
  }

  /**
   * 1 フレーム分を記録
   * @param {object} f
   * @param {number} f.t フレームの時刻（ms）
   * @param {Array<{x:number,y:number,z:number}>|null} f.hand 選択済み右手の正規化ランドマーク（未検出時は null）
   * @param {number} f.handsDetected MediaPipe が検出した手の数（右手選択の前）
   * @param {number} f.width Canvas 幅（px）
   * @param {number} f.height Canvas 高（px）
   * @param {string} f.targetFinger アプリが示している対象指
   * @param {number} f.step 曲のステップ（0 始まり）
   */
  onFrame(f) {
    if (!this.isRecording) return;
    const cols = [
      f.t.toFixed(1), f.hand ? 1 : 0, f.handsDetected, f.width, f.height,
      this.kind, this.finger, f.targetFinger, f.step, this.readMicPeak()
    ];
    if (f.hand) {
      for (let i = 0; i < 21; i++) {
        const p = f.hand[i];
        cols.push(p.x.toFixed(5), p.y.toFixed(5), (p.z ?? 0).toFixed(5));
      }
    } else {
      for (let i = 0; i < 63; i++) cols.push("");
    }
    this.lines.push(cols.join(","));
    if (this.ui.status && this.lines.length % 15 === 0) {
      const sec = (performance.now() - this.startedAt) / 1000;
      this.ui.status.textContent = `録画中 ${sec.toFixed(1)} 秒 / ${this.lines.length - 1} フレーム`;
    }
  }

  /** 録画を止めて CSV をダウンロード */
  stop() {
    if (!this.isRecording) return null;
    this.isRecording = false;
    this.closeMic();
    const frames = this.lines.length - 1;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const filename = `rec_${this.finger.toLowerCase()}_${this.kind}_${stamp}.csv`;
    const csv = this.lines.join("\n") + "\n";
    this.lines = [];
    if (frames > 0) {
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    if (this.ui.btn) {
      this.ui.btn.textContent = "録画開始";
      this.ui.kindSel.disabled = false;
      this.ui.fingerSel.disabled = false;
      this.ui.mic.disabled = false;
      this.ui.status.textContent = frames > 0 ? `保存しました: ${filename}（${frames} フレーム）` : "フレームがありませんでした";
    }
    return { filename, frames, csv };
  }
}
