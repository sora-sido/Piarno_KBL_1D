#!/usr/bin/env node
/**
 * 録画データセットの再生検証ツール
 *
 * public/dataset/ の CSV（指先・付け根・手首の座標を持つ形式）を 1 フレームずつ
 * アプリと同じ判定コード（tap-detector.js）に通し、打鍵の検出率と誤検知数を数える。
 * 閾値もアプリと同じ手順（threshold-model.js）で CSV から導出する。
 *
 *   node tools/replay-dataset.mjs            # 表を表示
 *   node tools/replay-dataset.mjs --json     # JSON で出力
 *   node tools/replay-dataset.mjs --scale 0.5  # 座標を縮小して解像度依存を確認
 *
 * 人差し指の CSV は座標を持たない別形式なので対象外。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TapDetector } from "../tap-detector.js";
import { parseCsv, deriveFingerThreshold } from "../threshold-model.js";
import { FINGER_CONFIGS, FINGER_VY_THRESHOLDS } from "../finger-config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATASET_DIR = path.join(ROOT, "public", "dataset");

// 録画時の Canvas サイズ（座標の最大値から 1280x720 と推定）。ry の分母の下限にのみ影響する
const REC_WIDTH = 1280;
const REC_HEIGHT = 720;
// 連続する打鍵ラベルを 1 回の打鍵にまとめる間隔と、検出と打鍵を対応づける許容差
const LABEL_MERGE_MS = 120;
const MATCH_TOLERANCE_MS = 250;
// これより短い間隔で続いた検出は「1 回の打鍵で 2 回鳴った」とみなす
const DOUBLE_TRIGGER_MS = 200;

const args = process.argv.slice(2);
const asJson = args.includes("--json");
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
  return m ? m[1] : "other";
}

/** 座標つき形式の CSV をフレーム列に変換（座標を持たない形式なら null） */
function loadFrames(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const col = (n) => head.indexOf(n);
  if (col("tip_y") === -1 || col("wrist_y") === -1) return null;
  const frames = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const t = parseFloat(c[col("time_sec")]) * 1000;
    const isHit = c[col("is_hit")] === "1";
    const hasHand = c[col("has_hand")] === "1" && c[col("tip_y")] !== "";
    if (!hasHand) {
      frames.push({ t, hasHand: false, isHit });
      continue;
    }
    const num = (n) => parseFloat(c[col(n)]);
    frames.push({
      t, hasHand: true, isHit,
      tip: { x: num("tip_x"), y: num("tip_y") },
      mcp: { x: num("mcp_x"), y: num("mcp_y") },
      wrist: { x: num("wrist_x"), y: num("wrist_y") }
    });
  }
  return frames;
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
function replay(frames, fingerKey, model) {
  const cfg = FINGER_CONFIGS[fingerKey];
  const detector = new TapDetector(process.env.DET_OPT ? JSON.parse(process.env.DET_OPT) : {});
  const hits = [];
  const norm = (pt) => ({ x: (pt.x * scale) / (REC_WIDTH * scale), y: (pt.y * scale) / (REC_HEIGHT * scale) });
  for (const f of frames) {
    let hand = null;
    if (f.hasHand) {
      // 録画にあるのは手首・付け根・指先のみ。判定に使わない関節は付け根の座標で埋める
      const wrist = norm(f.wrist);
      const mcp = norm(f.mcp);
      hand = Array.from({ length: 21 }, () => mcp);
      hand[0] = wrist;
      hand[cfg.baseIdx] = mcp;
      hand[cfg.tipIdx] = norm(f.tip);
    }
    const r = detector.update(hand, {
      now: f.t,
      width: REC_WIDTH * scale,
      height: REC_HEIGHT * scale,
      fingerKey,
      finger: cfg,
      hitRy: model.hitRy,
      vyTh: FINGER_VY_THRESHOLDS[fingerKey],
      gateOpen: true
    });
    if (r.event === "HIT") hits.push(f.t);
  }
  return hits;
}

// ---- データセット読込（アプリの loadTestDataCsv と同じ分類） ----
const manifest = JSON.parse(fs.readFileSync(path.join(DATASET_DIR, "manifest.json"), "utf8"));
const fileList = manifest.fingers ? Object.values(manifest.fingers).flat() : manifest.files || manifest;
const quietLog = console.log;
console.log = () => {}; // parseCsv のピーク検出ログを抑止
const datasetsByFinger = {};
const recordings = [];
for (const fname of fileList) {
  const text = fs.readFileSync(path.join(DATASET_DIR, fname), "utf8");
  const display = fname.includes("/") ? fname.split("/").pop() : fname;
  const fingerKey = detectFingerKey(fname);
  const parsed = parseCsv(text, display);
  if (parsed.length > 0) {
    (datasetsByFinger[fingerKey] ||= []).push({ filename: display, frames: parsed });
  }
  const frames = loadFrames(text);
  if (frames) recordings.push({ fingerKey, kind: fileKind(display), name: fname, frames });
}
console.log = quietLog;

const models = {};
for (const k of Object.keys(datasetsByFinger)) {
  models[k] = deriveFingerThreshold(datasetsByFinger[k], k);
}

// ---- 再生 ----
const rows = [];
const total = { labels: 0, tp: 0, miss: 0, extra: 0, doubles: 0 };
const negatives = {};
for (const rec of recordings) {
  const model = models[rec.fingerKey];
  const hits = replay(rec.frames, rec.fingerKey, model);
  const durationSec = (rec.frames[rec.frames.length - 1].t - rec.frames[0].t) / 1000;
  if (rec.kind === "tap") {
    const labels = labelEvents(rec.frames);
    const m = matchEvents(labels, hits);
    m.doubles = hits.filter((h, i) => i > 0 && h - hits[i - 1] < DOUBLE_TRIGGER_MS).length;
    total.doubles += m.doubles;
    total.labels += labels.length;
    total.tp += m.tp;
    total.miss += m.miss;
    total.extra += m.extra;
    rows.push({ finger: rec.fingerKey, kind: rec.kind, durationSec, labels: labels.length, hits: hits.length, ...m });
  } else {
    const n = (negatives[rec.kind] ||= { hits: 0, durationSec: 0 });
    n.hits += hits.length;
    n.durationSec += durationSec;
    rows.push({ finger: rec.fingerKey, kind: rec.kind, durationSec, hits: hits.length });
  }
}
const recall = total.labels ? total.tp / total.labels : 0;
const falsePerMin = Object.fromEntries(
  Object.entries(negatives).map(([k, v]) => [k, (v.hits / v.durationSec) * 60])
);
const summary = { scale, models, total: { ...total, recall }, negatives, falsePerMin, rows };

if (asJson) {
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
} else {
  const pad = (s, n) => String(s).padStart(n);
  console.log(`座標スケール: ${scale}`);
  console.log("閾値（CSV から導出）:");
  for (const [k, m] of Object.entries(models)) {
    console.log(`  ${k.padEnd(7)} hitRy=${m.hitRy.toFixed(2)} liftRy=${m.liftRy.toFixed(2)} vyTH=${FINGER_VY_THRESHOLDS[k]} 打鍵サンプル=${m.samples}`);
  }
  console.log("\n指      種類    秒数  打鍵  検出  一致  漏れ  余分  二重");
  for (const r of rows) {
    if (r.kind === "tap") {
      console.log(`${r.finger.padEnd(7)} ${r.kind.padEnd(6)}${pad(r.durationSec.toFixed(1), 6)}${pad(r.labels, 6)}${pad(r.hits, 6)}${pad(r.tp, 6)}${pad(r.miss, 6)}${pad(r.extra, 6)}${pad(r.doubles, 6)}`);
    } else {
      console.log(`${r.finger.padEnd(7)} ${r.kind.padEnd(6)}${pad(r.durationSec.toFixed(1), 6)}${pad("-", 6)}${pad(r.hits, 6)}${pad("-", 6)}${pad("-", 6)}${pad(r.hits, 6)}`);
    }
  }
  console.log(`\n打鍵の検出率: ${(recall * 100).toFixed(1)}% (${total.tp}/${total.labels})  漏れ ${total.miss}  余分 ${total.extra}（うち 200ms 未満の二重検出 ${total.doubles}）`);
  console.log("打鍵していない録画での誤検知（回/分）:");
  for (const [k, v] of Object.entries(falsePerMin)) {
    console.log(`  ${k.padEnd(6)} ${v.toFixed(1)}  (${negatives[k].hits} 回 / ${negatives[k].durationSec.toFixed(0)} 秒)`);
  }
}
