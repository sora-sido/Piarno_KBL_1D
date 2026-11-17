#!/usr/bin/env node
/**
 * 録画データセットの再生検証ツール
 *
 * 録画した手の座標を 1 フレームずつアプリと同じ判定コード（tap-detector.js）に通し、
 * 打鍵の検出率と誤検知数を数える。判定ロジックを変えたら、このツールで結果を確かめる。
 *
 *   npm run replay                 表を表示
 *   npm run replay -- --json       JSON で出力
 *   npm run replay -- --scale 0.5  座標を縮小して、解像度に依存しないことを確認
 *   npm run replay:check           基準（tools/replay-baseline.json）を下回ったら終了コード 1
 *
 * 対象にするデータ:
 *  1. public/dataset/manifest.json にある、指先・付け根・手首の座標を持つ CSV
 *     （人差し指の CSV は座標を持たない別形式なので対象外）
 *  2. public/dataset/recordings/*.csv（?record で録画した、全 21 ランドマークの CSV）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TapDetector } from "../tap-detector.js";
import { FINGER_CONFIGS } from "../finger-config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATASET_DIR = path.join(ROOT, "public", "dataset");
const RECORDINGS_DIR = path.join(DATASET_DIR, "recordings");
const BASELINE_PATH = path.join(ROOT, "tools", "replay-baseline.json");

// 旧形式の録画時の Canvas サイズ（座標の最大値から 1280x720 と推定）。基準長 L の下限にのみ影響する
const LEGACY_WIDTH = 1280;
const LEGACY_HEIGHT = 720;
// 連続する打鍵ラベルを 1 回の打鍵にまとめる間隔と、検出と打鍵を対応づける許容差
const LABEL_MERGE_MS = 120;
const MATCH_TOLERANCE_MS = 250;
// これより短い間隔で続いた検出は「1 回の打鍵で 2 回鳴った」とみなす
const DOUBLE_TRIGGER_MS = 200;
// マイク音量から打鍵（机を叩く音の立ち上がり）を取り出すときの条件
const MIC_MIN_PEAK = 0.05;
const MIC_MEDIAN_FACTOR = 6;

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const doCheck = args.includes("--check");
const scaleIdx = args.indexOf("--scale");
const scale = scaleIdx !== -1 ? parseFloat(args[scaleIdx + 1]) : 1.0;

function detectFingerKey(p) {
  const s = p.toLowerCase();
  for (const k of ["thumb", "middle", "ring", "pinky", "index"]) {
    if (s.includes(k)) return k.toUpperCase();
  }
  return "THUMB";
}

function fileKind(name) {
  if (name.includes("tap")) return "tap";
  const m = name.match(/neg_([a-z]+)/);
  return m ? `neg_${m[1]}` : "other";
}

function parseTable(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  return { idx, rows: lines.slice(1).map((l) => l.split(",")) };
}

/**
 * 旧形式（指先・付け根・手首のみ）の CSV を読む。座標を持たない形式なら null
 * 判定に使わない関節は付け根の座標で埋める
 */
function loadLegacy(text, fingerKey) {
  const { idx, rows } = parseTable(text);
  if (idx.tip_y === undefined || idx.wrist_y === undefined) return null;
  const cfg = FINGER_CONFIGS[fingerKey];
  const frames = [];
  for (const c of rows) {
    const t = parseFloat(c[idx.time_sec]) * 1000;
    const isHit = c[idx.is_hit] === "1";
    if (c[idx.has_hand] !== "1" || c[idx.tip_y] === "") {
      frames.push({ t, hand: null, isHit, width: LEGACY_WIDTH, height: LEGACY_HEIGHT, targetFinger: fingerKey });
      continue;
    }
    const pt = (xn, yn) => ({ x: parseFloat(c[idx[xn]]) / LEGACY_WIDTH, y: parseFloat(c[idx[yn]]) / LEGACY_HEIGHT });
    const mcp = pt("mcp_x", "mcp_y");
    const hand = Array.from({ length: 21 }, () => mcp);
    hand[0] = pt("wrist_x", "wrist_y");
    hand[cfg.baseIdx] = mcp;
    hand[cfg.tipIdx] = pt("tip_x", "tip_y");
    frames.push({ t, hand, isHit, width: LEGACY_WIDTH, height: LEGACY_HEIGHT, targetFinger: fingerKey });
  }
  return { frames, labelSource: "csv" };
}

/** ?record で録画した全 21 ランドマークの CSV を読む。別形式なら null */
function loadRecording(text) {
  const { idx, rows } = parseTable(text);
  if (idx.lm0_x === undefined) return null;
  const frames = [];
  let kind = "free";
  let labelFinger = "ALL";
  for (const c of rows) {
    kind = c[idx.label_kind] || kind;
    labelFinger = c[idx.label_finger] || labelFinger;
    const micRaw = c[idx.mic_peak];
    const frame = {
      t: parseFloat(c[idx.t_ms]),
      hand: null,
      isHit: false,
      width: parseFloat(c[idx.width]),
      height: parseFloat(c[idx.height]),
      targetFinger: labelFinger !== "ALL" ? labelFinger : c[idx.target_finger],
      mic: micRaw === "" || micRaw === undefined ? null : parseFloat(micRaw)
    };
    if (c[idx.has_hand] === "1") {
      frame.hand = Array.from({ length: 21 }, (_, i) => ({
        x: parseFloat(c[idx[`lm${i}_x`]]),
        y: parseFloat(c[idx[`lm${i}_y`]])
      }));
    }
    frames.push(frame);
  }
  // マイク音量の立ち上がりを打鍵の目印にする（判定ロジックとは独立した正解）
  const mics = frames.map((f) => f.mic).filter((v) => v !== null);
  let labelSource = "none";
  if (mics.length > frames.length / 2) {
    const sorted = [...mics].sort((a, b) => a - b);
    const threshold = Math.max(MIC_MIN_PEAK, sorted[sorted.length >> 1] * MIC_MEDIAN_FACTOR);
    let prevAbove = false;
    for (const f of frames) {
      const above = f.mic !== null && f.mic >= threshold;
      if (above && !prevAbove) f.isHit = true;
      prevAbove = above;
    }
    labelSource = "mic";
  }
  return { frames, kind, fingerKey: labelFinger, labelSource };
}

/** 連続する打鍵ラベルを 1 回の打鍵イベント（先頭時刻）にまとめる */
function labelEvents(frames) {
  const ev = [];
  let last = -Infinity;
  for (const f of frames) {
    if (!f.isHit) continue;
    if (f.t - last > LABEL_MERGE_MS) ev.push(f.t);
    last = f.t;
  }
  return ev;
}

/** 検出時刻と打鍵時刻を 1 対 1 で対応づける */
function matchEvents(labels, hits) {
  const used = new Set();
  let tp = 0;
  for (const l of labels) {
    let best = -1;
    for (let i = 0; i < hits.length; i++) {
      if (used.has(i) || Math.abs(hits[i] - l) > MATCH_TOLERANCE_MS) continue;
      if (best === -1 || Math.abs(hits[i] - l) < Math.abs(hits[best] - l)) best = i;
    }
    if (best !== -1) {
      used.add(best);
      tp++;
    }
  }
  return { tp, miss: labels.length - tp, extra: hits.length - tp };
}

/** 1 本の録画を判定器に通し、HIT の時刻を返す */
function replay(frames) {
  // DET_OPT に JSON を渡すと判定パラメータを上書きして試せる（例: DET_OPT='{"hitLockoutMs":150}'）
  const detector = new TapDetector(process.env.DET_OPT ? JSON.parse(process.env.DET_OPT) : {});
  const hits = [];
  for (const f of frames) {
    const r = detector.update(f.hand, {
      now: f.t,
      width: f.width * scale,
      height: f.height * scale,
      fingerKey: f.targetFinger,
      gateOpen: true
    });
    if (r.event === "HIT") hits.push(f.t);
  }
  return hits;
}

// ---- データセット読込 ----
const recordings = [];
const manifest = JSON.parse(fs.readFileSync(path.join(DATASET_DIR, "manifest.json"), "utf8"));
const fileList = manifest.fingers ? Object.values(manifest.fingers).flat() : manifest.files || manifest;
for (const fname of fileList) {
  const fingerKey = detectFingerKey(fname);
  const data = loadLegacy(fs.readFileSync(path.join(DATASET_DIR, fname), "utf8"), fingerKey);
  if (data) recordings.push({ set: "dataset", fingerKey, kind: fileKind(path.basename(fname)), name: fname, ...data });
}
if (fs.existsSync(RECORDINGS_DIR)) {
  for (const fname of fs.readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith(".csv")).sort()) {
    const data = loadRecording(fs.readFileSync(path.join(RECORDINGS_DIR, fname), "utf8"));
    if (data) recordings.push({ set: "recordings", name: `recordings/${fname}`, ...data });
  }
}

// ---- 再生 ----
// 正解つきの打鍵録画は検出率を、打鍵していない録画（neg_*）は誤検知数を集計する。それ以外は検出数のみ
const rows = [];
const summaryBySet = {};
for (const rec of recordings) {
  const s = (summaryBySet[rec.set] ||= { total: { labels: 0, tp: 0, miss: 0, extra: 0, doubles: 0 }, negatives: {} });
  const hits = replay(rec.frames);
  const durationSec = (rec.frames[rec.frames.length - 1].t - rec.frames[0].t) / 1000;
  const row = { set: rec.set, finger: rec.fingerKey, kind: rec.kind, name: rec.name, durationSec, hits: hits.length, labelSource: rec.labelSource };
  if (rec.kind.startsWith("neg_")) {
    const key = rec.kind.slice(4);
    const n = (s.negatives[key] ||= { hits: 0, durationSec: 0 });
    n.hits += hits.length;
    n.durationSec += durationSec;
    row.kind = key;
    row.isNegative = true;
  } else if (rec.kind === "tap" && rec.labelSource !== "none") {
    const labels = labelEvents(rec.frames);
    const m = matchEvents(labels, hits);
    m.doubles = hits.filter((h, i) => i > 0 && h - hits[i - 1] < DOUBLE_TRIGGER_MS).length;
    for (const k of ["tp", "miss", "extra", "doubles"]) s.total[k] += m[k];
    s.total.labels += labels.length;
    Object.assign(row, { labels: labels.length, ...m });
  }
  rows.push(row);
}
for (const s of Object.values(summaryBySet)) {
  s.total.recall = s.total.labels ? s.total.tp / s.total.labels : null;
  s.falsePerMin = Object.fromEntries(Object.entries(s.negatives).map(([k, v]) => [k, (v.hits / v.durationSec) * 60]));
}
const result = { scale, sets: summaryBySet, rows };

// ---- 出力 ----
if (asJson) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} else {
  const pad = (v, n) => String(v).padStart(n);
  const setTitle = { dataset: "同梱データセット（public/dataset）", recordings: "追加の録画（public/dataset/recordings）" };
  console.log(`座標スケール: ${scale}`);
  for (const [setName, s] of Object.entries(summaryBySet)) {
    console.log(`\n== ${setTitle[setName]} ==`);
    console.log("指      種類    秒数  打鍵  検出  一致  漏れ  余分  二重");
    for (const r of rows.filter((x) => x.set === setName)) {
      const base = `${String(r.finger).padEnd(7)} ${r.kind.padEnd(6)}${pad(r.durationSec.toFixed(1), 6)}`;
      if (r.labels !== undefined) {
        const note = r.labelSource === "mic" ? "  ※正解はマイクの音" : "";
        console.log(`${base}${pad(r.labels, 6)}${pad(r.hits, 6)}${pad(r.tp, 6)}${pad(r.miss, 6)}${pad(r.extra, 6)}${pad(r.doubles, 6)}${note}`);
      } else {
        const note = r.isNegative ? "" : "  ※正解なし（検出数のみ）";
        console.log(`${base}${pad("-", 6)}${pad(r.hits, 6)}${pad("-", 6)}${pad("-", 6)}${pad(r.isNegative ? r.hits : "-", 6)}${pad("-", 6)}${note}`);
      }
    }
    const t = s.total;
    if (t.labels > 0) {
      console.log(`\n打鍵の検出率: ${(t.recall * 100).toFixed(1)}% (${t.tp}/${t.labels})  漏れ ${t.miss}  余分 ${t.extra}（うち 200ms 未満の二重検出 ${t.doubles}）`);
    }
    if (Object.keys(s.negatives).length > 0) {
      console.log("打鍵していない録画での誤検知（回/分）:");
      for (const [k, v] of Object.entries(s.falsePerMin)) {
        console.log(`  ${k.padEnd(6)} ${v.toFixed(1)}  (${s.negatives[k].hits} 回 / ${s.negatives[k].durationSec.toFixed(0)} 秒)`);
      }
    }
  }
}

// ---- 基準との比較（同梱データセットのみ） ----
if (doCheck) {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  const s = summaryBySet.dataset;
  const failures = [];
  if (s.total.tp < baseline.minDetected) failures.push(`検出できた打鍵 ${s.total.tp} 件 < 基準 ${baseline.minDetected} 件`);
  if (s.total.doubles > baseline.maxDoubles) failures.push(`二重検出 ${s.total.doubles} 件 > 基準 ${baseline.maxDoubles} 件`);
  for (const [k, max] of Object.entries(baseline.maxFalseHits)) {
    const got = s.negatives[k]?.hits ?? 0;
    if (got > max) failures.push(`${k} の誤検知 ${got} 回 > 基準 ${max} 回`);
  }
  if (failures.length > 0) {
    console.error("\n基準を下回りました:\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.error("\n基準を満たしています。");
}
