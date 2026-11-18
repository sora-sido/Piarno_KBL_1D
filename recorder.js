/**
 * 演奏の記録と振り返り（recorder.js）
 *
 * 右上の ● ボタンで記録を開始すると、カウントダウン後の演奏をコマ単位で記録する。
 *  - 各コマのカメラ画像（縮小JPEG）
 *  - 21関節の平滑化座標
 *  - 5本の指それぞれの下がり具合（ry）と下向きの速さ（vy）
 *  - その時に弾くべき音（ステップ）・対象の指・判定状態・HIT
 * 記録が終わると振り返り画面を開き、音が鳴ったコマと、
 * 「叩こうとした動きがあったのに鳴らなかった」コマ（見逃し候補）を実際の画像で表示する。
 */

const FINGERS = ["THUMB", "INDEX", "MIDDLE", "RING", "PINKY"];
const FINGER_JP = { THUMB: "親指", INDEX: "人差し指", MIDDLE: "中指", RING: "薬指", PINKY: "小指" };
const FINGER_NUM = { THUMB: 1, INDEX: 2, MIDDLE: 3, RING: 4, PINKY: 5 };
// 振り返り画像に描く関節（指ごと：付け根→第2関節→第1関節→指先）
const FINGER_CHAIN = {
  THUMB: [1, 2, 3, 4], INDEX: [5, 6, 7, 8], MIDDLE: [9, 10, 11, 12], RING: [13, 14, 15, 16], PINKY: [17, 18, 19, 20]
};
const FINGER_BASE = { THUMB: 2, INDEX: 5, MIDDLE: 9, RING: 13, PINKY: 17 };

const IMG_WIDTH = 200;          // 記録する画像の横幅（px）
const MAX_RECORD_MS = 120000;   // 記録の上限（2分）
const STOP_DELAY_MS = 900;      // 指定範囲の最後の音が鳴ってから記録を止めるまで

const rec = {
  armed: false,
  active: false,
  t0: 0,
  frames: [],
  meta: null,
  stopTimer: null,
  capCanvas: null,
  capCtx: null,
  onRestart: null
};

let recordBtn = null;

/* ------------------------------------------------------------------ */
/* 記録の制御                                                           */
/* ------------------------------------------------------------------ */

export function isRecording() {
  return rec.active;
}

export function isArmed() {
  return rec.armed;
}

/**
 * ● ボタンの設置。onArm は「記録の準備ができたので曲を最初から始める」処理
 */
export function setupRecordButton(container, onArm) {
  injectStyles();
  rec.onRestart = onArm;
  recordBtn = document.createElement("button");
  recordBtn.id = "record-btn";
  recordBtn.type = "button";
  recordBtn.className = "sp-row rec-btn";
  recordBtn.setAttribute("aria-label", "演奏を記録して振り返る");
  recordBtn.title = "演奏を記録して振り返る";
  recordBtn.innerHTML = `<span class="rec-dot" aria-hidden="true"></span><span class="rec-label">演奏を記録して振り返る</span>`;
  recordBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (rec.active) {
      stopRecording("手動で停止");
    } else if (rec.armed) {
      rec.armed = false;
      updateButton();
    } else {
      rec.armed = true;
      updateButton();
      showToast("● 記録の準備OK。曲の最初からカウントダウン後に記録します");
      if (rec.onRestart) rec.onRestart();
    }
  });
  container.appendChild(recordBtn);
  updateButton();
}

function updateButton() {
  if (!recordBtn) return;
  recordBtn.classList.toggle("armed", rec.armed && !rec.active);
  recordBtn.classList.toggle("recording", rec.active);
  recordBtn.setAttribute("aria-pressed", String(rec.armed || rec.active));
  recordBtn.title = rec.active ? "記録を止めて振り返る" : rec.armed ? "記録の準備中（タップで取り消し）" : "演奏を記録して振り返る";
  const label = recordBtn.querySelector(".rec-label");
  if (label) label.textContent = recordBtn.title;
  // 設定パネルを閉じていても記録中と分かるように、⚙ ボタンに赤い点を出す
  document.body.classList.toggle("is-recording", rec.active);
  document.body.classList.toggle("is-rec-armed", rec.armed && !rec.active);
}

/**
 * 演奏開始（カウントダウン終了）時に呼ぶ。準備済みなら記録を始める
 * meta: { songId, songTitle, sequence, stopAfterStep, rangeLabel, thresholds, vth, rise }
 */
export function onPlayStart(meta) {
  if (!rec.armed) return;
  rec.armed = false;
  rec.active = true;
  rec.frames = [];
  rec.meta = meta;
  rec.t0 = performance.now();
  clearTimeout(rec.stopTimer);
  rec.stopTimer = setTimeout(() => stopRecording("上限の2分に達したため停止"), MAX_RECORD_MS);
  updateButton();
  showToast(`● 記録中：${meta.rangeLabel}`);
}

/**
 * 音が鳴ったときに呼ぶ。指定範囲の最後の音なら少し待って記録を止める
 */
export function onHit(stepIndex) {
  if (!rec.active || !rec.meta) return;
  if (stepIndex >= rec.meta.stopAfterStep) {
    clearTimeout(rec.stopTimer);
    rec.stopTimer = setTimeout(() => stopRecording(`${rec.meta.rangeLabel}を弾き終えたため停止`), STOP_DELAY_MS);
  }
}

/**
 * 推論1コマごとに呼ぶ
 * f: { lost, step, target, state, hit, ry:{}, vy:{}, pts:[[x,y]...], w, h }
 */
export function recordFrame(video, f) {
  if (!rec.active) return;
  const frame = { ...f, t: Math.round(performance.now() - rec.t0), img: null };
  rec.frames.push(frame);
  captureImage(video, frame);
}

function captureImage(video, frame) {
  if (!video || !video.videoWidth) return;
  if (!rec.capCanvas) {
    rec.capCanvas = document.createElement("canvas");
    rec.capCtx = rec.capCanvas.getContext("2d");
  }
  const w = IMG_WIDTH;
  const h = Math.round(video.videoHeight * (w / video.videoWidth));
  if (rec.capCanvas.width !== w || rec.capCanvas.height !== h) {
    rec.capCanvas.width = w;
    rec.capCanvas.height = h;
  }
  try {
    rec.capCtx.drawImage(video, 0, 0, w, h);
    rec.capCanvas.toBlob((blob) => {
      if (blob) frame.img = URL.createObjectURL(blob);
    }, "image/jpeg", 0.72);
  } catch (err) {
    console.warn("[REC] 画像の記録に失敗:", err);
  }
}

export function stopRecording(reason) {
  if (!rec.active) return;
  rec.active = false;
  clearTimeout(rec.stopTimer);
  updateButton();
  const frames = rec.frames;
  const meta = { ...rec.meta, stopReason: reason, durationMs: frames.length ? frames[frames.length - 1].t : 0 };
  // toBlob の完了を少し待ってから振り返りを開く
  setTimeout(() => openReview(frames, meta), 350);
}

/* ------------------------------------------------------------------ */
/* 解析：音が鳴った打鍵と、鳴らなかった打鍵の動き（見逃し候補）を探す         */
/* ------------------------------------------------------------------ */

function analyze(frames, meta) {
  const valid = frames.filter((f) => !f.lost);
  const events = [];

  // 1. 音が鳴った打鍵
  frames.forEach((f, i) => {
    if (f.hit) events.push({ type: "hit", i, t: f.t, finger: f.target, step: f.step });
  });

  // 2. 指ごとに「下ろす動き」を探す（直前0.3秒の最高点から一定以上下がり、ある程度の速さがあった極大点）
  const strokeAmp = (F) => (F === "THUMB" ? 0.08 : 0.15);
  const hitTimes = events.map((e) => e.t);
  const nearHit = (t, before, after) => hitTimes.some((ht) => ht >= t - before && ht <= t + after);

  FINGERS.forEach((F) => {
    for (let k = 1; k < valid.length - 1; k++) {
      const f = valid[k];
      const ry = f.ry[F];
      if (!(ry >= valid[k - 1].ry[F] && ry > valid[k + 1].ry[F])) continue;
      const win = valid.filter((x) => x.t >= f.t - 300 && x.t <= f.t);
      const top = Math.min(...win.map((x) => x.ry[F]));
      const amp = ry - top;
      if (amp < strokeAmp(F)) continue;
      const vmax = Math.max(...win.filter((x) => x.t >= f.t - 220).map((x) => x.vy[F]));
      if (vmax < 2.0) continue;
      if (nearHit(f.t, 250, 120)) continue; // 近くで音が鳴っている → その打鍵の一部

      const i = frames.indexOf(f);
      if (f.target === F) {
        events.push({ type: "miss", i, t: f.t, finger: F, step: f.step, amp, vmax, why: missReason(frames, i, F, meta) });
      } else if (amp >= (F === "THUMB" ? 0.15 : 0.25) && vmax >= (meta.vth[F] || 6) * 0.8) {
        events.push({ type: "wrong", i, t: f.t, finger: F, target: f.target, step: f.step, amp, vmax });
      }
    }
  });

  // 対象の指の「見逃し候補」と同時に起きた、別の指の動きは除く（指は連動して動くため）
  const misses = events.filter((e) => e.type === "miss");
  const filtered = events.filter((e) => e.type !== "wrong" || !misses.some((m) => Math.abs(m.t - e.t) <= 150));
  // 同じ指の近すぎる「別の指」イベントはまとめる
  filtered.sort((a, b) => a.t - b.t);
  const out = [];
  filtered.forEach((e) => {
    const prev = out[out.length - 1];
    if (prev && e.type === "wrong" && prev.type === "wrong" && Math.abs(prev.t - e.t) < 200) return;
    out.push(e);
  });

  const fps = valid.length > 1 ? (valid.length - 1) / ((valid[valid.length - 1].t - valid[0].t) / 1000) : 0;
  return { events: out, fps };
}

function missReason(frames, i, F, meta) {
  const t = frames[i].t;
  const win = frames.filter((x) => !x.lost && x.t >= t - 250 && x.t <= t + 60 && x.target === F);
  const hit = meta.thresholds[F].hitRy;
  const lift = meta.thresholds[F].liftRy;
  const vth = meta.vth[F];
  const maxRy = Math.max(...win.map((x) => x.ry[F]));
  const maxVy = Math.max(...win.map((x) => x.vy[F]));
  const idle = win.filter((x) => x.state === "IDLE");
  const base = { maxRy, maxVy, hit, lift, vth };
  if (!win.length) return { code: "lost", ...base };
  if (!idle.length) return { code: "stuck", ...base };
  if (!idle.some((x) => x.ry[F] >= hit)) return { code: "lowRy", ...base };
  if (!idle.some((x) => x.vy[F] >= vth)) return { code: "lowVy", ...base };
  return { code: "noOverlap", ...base };
}

/* ------------------------------------------------------------------ */
/* 振り返り画面                                                          */
/* ------------------------------------------------------------------ */

let reviewEl = null;

function openReview(frames, meta) {
  const { events, fps } = analyze(frames, meta);
  if (reviewEl) reviewEl.remove();
  reviewEl = document.createElement("div");
  reviewEl.className = "rv-overlay";
  reviewEl.setAttribute("role", "dialog");
  reviewEl.setAttribute("aria-label", "演奏の振り返り");

  const seq = meta.sequence;
  const lastStep = Math.min(meta.stopAfterStep, seq.length - 1);
  const hits = events.filter((e) => e.type === "hit");
  const misses = events.filter((e) => e.type === "miss");
  const wrongs = events.filter((e) => e.type === "wrong");
  const valid = frames.filter((f) => !f.lost);
  const avgMs = valid.length > 1 ? (valid[valid.length - 1].t - valid[0].t) / (valid.length - 1) : 0;

  // 音ごとの集計
  const noteRows = [];
  for (let s = 0; s <= lastStep; s++) {
    const n = seq[s];
    const h = hits.find((e) => e.step === s);
    const prevH = hits.find((e) => e.step === s - 1);
    const ms = misses.filter((e) => e.step === s);
    const ws = wrongs.filter((e) => e.step === s);
    noteRows.push({ s, n, h, gap: h && prevH ? h.t - prevH.t : null, ms, ws });
  }

  reviewEl.innerHTML = `
    <div class="rv-sheet">
      <header class="rv-head">
        <div>
          <h2>演奏の振り返り</h2>
          <p>${esc(meta.songTitle)} ・ ${esc(meta.rangeLabel)} ・ ${(meta.durationMs / 1000).toFixed(1)}秒 ・ ${esc(meta.stopReason)}</p>
        </div>
        <div class="rv-actions">
          <button type="button" class="rv-btn" id="rv-save">記録を保存</button>
          <button type="button" class="rv-btn primary" id="rv-close">閉じる</button>
        </div>
      </header>

      <section class="rv-kpis">
        <div><span>鳴った音</span><b>${hits.filter((e) => e.step <= lastStep).length} / ${lastStep + 1}</b></div>
        <div><span>見逃し候補</span><b class="${misses.length ? "ng" : ""}">${misses.length}</b><small>叩こうとした動きがあったのに鳴らなかった</small></div>
        <div><span>別の指の動き</span><b>${wrongs.length}</b><small>弾くべき指と違う指が叩く動きをした</small></div>
        <div><span>判定の頻度</span><b>${fps.toFixed(0)} fps</b><small>平均 ${avgMs.toFixed(0)}ms おき</small></div>
      </section>

      <section>
        <h3>タイムライン</h3>
        <p class="rv-note">線はその時に弾くべき指の下がり具合です。<span class="rv-flag hit">♪</span>は音が鳴った瞬間、<span class="rv-flag miss">✕</span>は叩こうとした動きがあったのに鳴らなかった瞬間、<span class="rv-flag wrong">?</span>は別の指が叩く動きをした瞬間です。印をタップすると、その瞬間の画像を下に表示します。</p>
        <div class="rv-scroll" id="rv-timeline"></div>
      </section>

      <section id="rv-detail-sec">
        <h3 id="rv-detail-title">瞬間の画像</h3>
        <div id="rv-detail"></div>
      </section>

      <section>
        <h3>音ごとの結果</h3>
        <div class="rv-scroll">
          <table class="rv-table">
            <thead><tr><th>音</th><th>音名</th><th>指</th><th>鳴った時刻</th><th>前の音から</th><th>見逃し候補</th><th>別の指</th></tr></thead>
            <tbody>
              ${noteRows.map((r) => `<tr class="${r.ms.length ? "has-miss" : ""}">
                <td class="mono">第${r.s + 1}音</td>
                <td>${esc(r.n.note)}</td>
                <td>${FINGER_NUM[r.n.fingerKey]} ${FINGER_JP[r.n.fingerKey]}</td>
                <td class="mono">${r.h ? `<button type="button" class="rv-link" data-ev="${events.indexOf(r.h)}">${(r.h.t / 1000).toFixed(2)}s</button>` : `<span class="ng">鳴らず</span>`}</td>
                <td class="mono">${r.gap !== null ? `${(r.gap / 1000).toFixed(2)}s` : "-"}</td>
                <td>${r.ms.length ? r.ms.map((m) => `<button type="button" class="rv-link ng" data-ev="${events.indexOf(m)}">✕ ${(m.t / 1000).toFixed(2)}s</button>`).join(" ") : "-"}</td>
                <td>${r.ws.length ? r.ws.map((w) => `<button type="button" class="rv-link" data-ev="${events.indexOf(w)}">${FINGER_JP[w.finger]} ${(w.t / 1000).toFixed(2)}s</button>`).join(" ") : "-"}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>
      <p class="rv-note">画像は記録時に縮小しています（横${IMG_WIDTH}px）。左右は演奏中の画面と同じく鏡像で表示しています。見逃し候補は「弾くべき指が、直前0.3秒の最高点から一定以上下がり、ある程度の速さもあったのに、音が鳴らなかった瞬間」を自動で拾ったものです。指を構え直しただけの動きも混ざることがあります。</p>
    </div>`;
  document.body.appendChild(reviewEl);

  renderTimeline(frames, events, meta);
  reviewEl.querySelectorAll(".rv-link").forEach((b) => b.addEventListener("click", () => showEvent(frames, events, meta, +b.dataset.ev)));
  reviewEl.querySelector("#rv-close").addEventListener("click", () => reviewEl.remove());
  reviewEl.querySelector("#rv-save").addEventListener("click", () => saveRecording(frames, meta, events));

  const first = events.findIndex((e) => e.type === "miss");
  showEvent(frames, events, meta, first >= 0 ? first : events.findIndex((e) => e.type === "hit"));
}

function renderTimeline(frames, events, meta) {
  const box = reviewEl.querySelector("#rv-timeline");
  const valid = frames.filter((f) => !f.lost);
  if (!valid.length) { box.innerHTML = `<p class="rv-note">手が検出されたコマがありません。</p>`; return; }
  const T = Math.max(1, frames[frames.length - 1].t);
  const W = Math.max(900, Math.round(T / 1000 * 140)), H = 200, L = 36, R = 16, Tp = 30, B = 40;
  const X = (t) => L + t / T * (W - L - R);
  const ys = valid.map((f) => f.ry[f.target]);
  const lo = Math.min(...ys) - 0.1, hi = Math.max(...ys) + 0.1;
  const Y = (v) => Tp + (1 - (v - lo) / (hi - lo)) * (H - Tp - B);
  let path = "", prev = null;
  valid.forEach((f) => {
    const cont = prev && prev.target === f.target && f.t - prev.t < 200;
    path += `${cont ? "L" : "M"}${X(f.t).toFixed(1)} ${Y(f.ry[f.target]).toFixed(1)}`;
    prev = f;
  });
  const steps = [];
  let lastStep = -1;
  frames.forEach((f) => {
    if (f.step !== lastStep) {
      lastStep = f.step;
      const n = meta.sequence[f.step];
      if (n) steps.push(`<line x1="${X(f.t)}" x2="${X(f.t)}" y1="${Tp}" y2="${H - B}" stroke="currentColor" opacity=".12"/>
        <text x="${X(f.t) + 3}" y="${H - B + 14}" font-size="10.5" fill="currentColor" opacity=".7">${f.step + 1}:${esc(n.note)}${FINGER_NUM[n.fingerKey]}</text>`);
    }
  });
  const marks = events.map((e, idx) => {
    const x = X(e.t);
    const c = e.type === "hit" ? "#f0913f" : e.type === "miss" ? "#f0626c" : "#9aa4b4";
    const sym = e.type === "hit" ? "♪" : e.type === "miss" ? "✕" : "?";
    return `<g class="rv-mark" data-ev="${idx}" style="cursor:pointer">
      <line x1="${x}" x2="${x}" y1="${Tp - 4}" y2="${H - B}" stroke="${c}" stroke-width="${e.type === "wrong" ? 1 : 2}" ${e.type === "wrong" ? 'stroke-dasharray="3 3"' : ""}/>
      <circle cx="${x}" cy="${Tp - 14}" r="10" fill="${c}"/>
      <text x="${x}" y="${Tp - 10}" font-size="12" text-anchor="middle" fill="#fff" font-weight="700">${sym}</text>
      <rect x="${x - 10}" y="0" width="20" height="${H}" fill="transparent"/></g>`;
  }).join("");
  const ticks = [];
  for (let s = 0; s <= T; s += 1000) ticks.push(`<text x="${X(s)}" y="${H - 6}" font-size="10.5" text-anchor="middle" fill="currentColor" opacity=".6">${s / 1000}s</text>`);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px">${steps.join("")}<path d="${path}" fill="none" stroke="#a888f0" stroke-width="1.8"/>${marks}${ticks.join("")}</svg>`;
  box.querySelectorAll(".rv-mark").forEach((g) => g.addEventListener("click", () => showEvent(frames, events, meta, +g.dataset.ev)));
}

const REASON = {
  stuck: (r) => `判定が前の打鍵の「押下中」のままで、受け付けられませんでした。指が「戻った」とみなされる位置（下がり具合 ${r.lift.toFixed(2)} 以下、または一番下がった位置からの戻り）まで戻っていません。`,
  lowRy: (r) => `指先の下がり具合が最大 ${r.maxRy.toFixed(2)} で、打鍵の基準 ${r.hit.toFixed(2)} に ${(r.hit - r.maxRy).toFixed(2)} 届きませんでした（速さは最大 ${r.maxVy.toFixed(1)}、基準 ${r.vth}）。`,
  lowVy: (r) => `下がり具合は基準を超えましたが、下向きの速さが最大 ${r.maxVy.toFixed(1)} で、基準 ${r.vth} に届きませんでした。そっと下ろしたか、コマとコマの間で速い瞬間を撮り逃しています。`,
  noOverlap: (r) => `下がり具合（最大 ${r.maxRy.toFixed(2)}）と速さ（最大 ${r.maxVy.toFixed(1)}）は、それぞれ別のコマでは基準を超えましたが、同じコマで両方そろいませんでした。`,
  lost: () => `この瞬間、手を見失っていました。`
};

function showEvent(frames, events, meta, idx) {
  const e = events[idx];
  const detail = reviewEl.querySelector("#rv-detail");
  const title = reviewEl.querySelector("#rv-detail-title");
  if (!e) { detail.innerHTML = `<p class="rv-note">表示する瞬間がありません。</p>`; return; }
  reviewEl.querySelectorAll(".rv-mark").forEach((g) => g.classList.toggle("sel", +g.dataset.ev === idx));
  const n = meta.sequence[e.step];
  const noteLabel = n ? `第${e.step + 1}音 ${n.note}（${FINGER_NUM[n.fingerKey]} ${FINGER_JP[n.fingerKey]}）` : "";
  let head, text, cls;
  if (e.type === "hit") {
    cls = "hit"; head = `♪ 鳴った：${noteLabel}`;
    text = `${(e.t / 1000).toFixed(2)}秒のコマで、下がり具合と速さの両方が基準を超えて音が鳴りました（橙の枠のコマ）。`;
  } else if (e.type === "miss") {
    cls = "miss"; head = `✕ 鳴らなかった：${noteLabel}を叩こうとした動き`;
    text = REASON[e.why.code](e.why);
  } else {
    cls = "wrong"; head = `? 別の指の動き：弾くべきは${noteLabel}`;
    text = `このとき弾くべき指は${FINGER_JP[e.target]}でしたが、${FINGER_JP[e.finger]}が叩く動き（下がり ${e.amp.toFixed(2)}・速さ ${e.vmax.toFixed(1)}）をしました。判定は弾くべき指しか見ていないため、音は鳴りません。`;
  }
  title.textContent = head;

  const lo = Math.max(0, e.i - 9), hi = Math.min(frames.length, e.i + 5);
  const F = e.type === "wrong" ? e.finger : (frames[e.i].target || e.finger);
  const th = meta.thresholds[F];
  const cells = [];
  for (let k = lo; k < hi; k++) {
    const f = frames[k];
    const dt = f.t - frames[e.i].t;
    const isHit = f.hit && f.target === F;
    const isEv = k === e.i;
    let flags = "";
    if (isHit) flags += `<span class="rv-flag hit">♪ 鳴った</span>`;
    if (isEv && e.type === "miss") flags += `<span class="rv-flag miss">✕ 鳴らず</span>`;
    if (isEv && e.type === "wrong") flags += `<span class="rv-flag wrong">? ${FINGER_JP[e.finger]}</span>`;
    if (f.lost) {
      cells.push(`<div class="rv-frame"><div class="rv-t">${dt > 0 ? "+" : ""}${dt}ms</div><div class="rv-img lost">手を見失った</div></div>`);
      continue;
    }
    const ry = f.ry[F], vy = f.vy[F];
    const okRy = ry >= th.hitRy, okVy = vy >= meta.vth[F];
    cells.push(`<div class="rv-frame ${isHit ? "hit" : ""} ${isEv && e.type === "miss" ? "miss" : ""}">
      <div class="rv-flags">${flags}</div>
      <div class="rv-t">${dt > 0 ? "+" : ""}${dt}ms</div>
      <div class="rv-img">${f.img ? `<img src="${f.img}" alt="">` : ""}${overlaySvg(f, F, th)}</div>
      <div class="rv-row"><span>下がり</span><span class="${okRy ? "ok" : "ng"}">${ry.toFixed(2)} ${okRy ? "✓" : "✕"}</span></div>
      <div class="rv-row"><span>速さ</span><span class="${okVy ? "ok" : "ng"}">${vy.toFixed(1)} ${okVy ? "✓" : "✕"}</span></div>
      <div class="rv-state ${f.state === "TOUCHED" ? "pressed" : ""}">${f.target !== F ? `対象:${FINGER_JP[f.target]}` : f.state === "TOUCHED" ? "押下中" : "待機"}</div>
    </div>`);
  }
  detail.innerHTML = `<div class="rv-why ${cls}">${esc(text)}</div>
    <div class="rv-scroll"><div class="rv-strip">${cells.join("")}</div></div>
    <p class="rv-note">基準：下がり具合 ${th.hitRy.toFixed(2)} 以上、速さ ${meta.vth[F]} 以上。橙の点線は「指先がここより下に来れば下がり具合が合格」の位置、指先の点は合格なら緑、不合格なら赤です。</p>`;
  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function overlaySvg(f, F, th) {
  if (!f.pts || !f.w) return "";
  const chain = FINGER_CHAIN[F];
  const P = (i) => f.pts[i];
  const wrist = P(0), base = P(FINGER_BASE[F]), tip = P(chain[3]);
  const dist = Math.max(Math.hypot(base[0] - wrist[0], base[1] - wrist[1]), f.h * 0.05);
  const lineY = base[1] + th.hitRy * dist;
  const okRy = f.ry[F] >= th.hitRy;
  const sw = f.w / 160;
  const pts = [0, ...chain].map((i) => P(i).join(",")).join(" ");
  return `<svg viewBox="0 0 ${f.w} ${f.h}" preserveAspectRatio="none">
    <line x1="0" x2="${f.w}" y1="${lineY}" y2="${lineY}" stroke="#f0913f" stroke-width="${sw * 1.4}" stroke-dasharray="${sw * 5} ${sw * 3}"/>
    <polyline points="${pts}" fill="none" stroke="#a888f0" stroke-width="${sw * 2.2}" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${tip[0]}" cy="${tip[1]}" r="${sw * 4.5}" fill="${okRy ? "#45c08a" : "#f0626c"}" stroke="#fff" stroke-width="${sw}"/>
  </svg>`;
}

async function saveRecording(frames, meta, events) {
  const btn = reviewEl.querySelector("#rv-save");
  btn.disabled = true;
  btn.textContent = "保存の準備中…";
  try {
    const toDataUrl = (url) => new Promise((resolve) => {
      if (!url) return resolve(null);
      fetch(url).then((r) => r.blob()).then((b) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(b);
      }).catch(() => resolve(null));
    });
    const out = [];
    for (const f of frames) out.push({ ...f, img: await toDataUrl(f.img) });
    const data = {
      app: "Piarno_KBL_1D", version: 1, recordedAt: new Date().toISOString(),
      meta: { ...meta, sequence: meta.sequence.map((n) => ({ step: n.step, note: n.note, rightNote: n.rightNote, fingerKey: n.fingerKey })) },
      events, frames: out
    };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `piarno_record_${meta.songId}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    btn.textContent = "保存しました";
  } catch (err) {
    console.error("[REC] 保存エラー:", err);
    btn.textContent = "保存に失敗しました";
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = "記録を保存"; }, 2500);
  }
}

/* ------------------------------------------------------------------ */
/* 補助                                                                 */
/* ------------------------------------------------------------------ */

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

let toastTimer = null;
function showToast(msg) {
  let el = document.getElementById("rec-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "rec-toast";
    el.className = "rec-toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function injectStyles() {
  if (document.getElementById("rec-styles")) return;
  const css = `
  .rec-btn .rec-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #f0626c; display: block; }
  .rec-btn.armed .rec-dot { background: rgba(240,98,108,.45); }
  .rec-btn.recording .rec-dot { background: #f0626c; animation: rec-pulse 1s ease-in-out infinite; }
  @keyframes rec-pulse { 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) { .rec-btn.recording .rec-dot { animation: none; } }
  .rec-toast { position: fixed; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%) translateY(20px);
    background: rgba(20,22,28,.92); color: #fff; font-size: 14px; padding: 10px 16px; border-radius: 8px; z-index: 3000;
    opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; max-width: calc(100vw - 32px); }
  .rec-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

  .rv-overlay { position: fixed; inset: 0; z-index: 4000; background: #0f1319; color: #e8ecf2; overflow-y: auto; -webkit-overflow-scrolling: touch;
    font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
    padding: calc(16px + env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) calc(32px + env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px)); }
  .rv-sheet { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: minmax(0,1fr); gap: 20px; }
  .rv-sheet > * { min-width: 0; }
  .rv-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; align-items: flex-start; }
  .rv-head h2 { margin: 0; font-size: 20px; }
  .rv-head p { margin: 4px 0 0; color: #9aa4b4; font-size: 13px; }
  .rv-actions { display: flex; gap: 8px; }
  .rv-btn { font: inherit; font-size: 14px; padding: 8px 14px; border-radius: 6px; border: 1px solid #3a4352; background: transparent; color: #e8ecf2; cursor: pointer; }
  .rv-btn.primary { background: #e8ecf2; color: #11151b; border-color: #e8ecf2; }
  .rv-btn:focus-visible, .rv-link:focus-visible { outline: 2px solid #f0913f; outline-offset: 2px; }
  .rv-sheet h3 { margin: 0 0 8px; font-size: 15px; }
  .rv-note { margin: 0 0 8px; color: #9aa4b4; font-size: 12.5px; line-height: 1.6; }
  .rv-kpis { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }
  .rv-kpis > div { border: 1px solid #2c3440; border-radius: 6px; padding: 10px 12px; display: grid; gap: 2px; }
  .rv-kpis span { color: #9aa4b4; font-size: 12px; }
  .rv-kpis b { font-size: 20px; font-variant-numeric: tabular-nums; }
  .rv-kpis small { color: #9aa4b4; font-size: 11px; line-height: 1.4; }
  .rv-sheet .ng { color: #f0626c; }
  .rv-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  #rv-timeline svg { display: block; height: auto; color: #e8ecf2; }
  .rv-mark.sel circle { stroke: #fff; stroke-width: 2.5; }
  .rv-flag { display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 3px; color: #fff; white-space: nowrap; }
  .rv-flag.hit { background: #e2700f; } .rv-flag.miss { background: #c8323c; } .rv-flag.wrong { background: #5d6676; }
  .rv-why { border-left: 3px solid #5d6676; padding: 8px 12px; font-size: 14px; line-height: 1.65; margin-bottom: 10px; background: #171c24; border-radius: 0 6px 6px 0; }
  .rv-why.hit { border-color: #f0913f; } .rv-why.miss { border-color: #f0626c; }
  .rv-strip { display: grid; grid-auto-flow: column; grid-auto-columns: 132px; gap: 6px; width: max-content; padding-top: 22px; }
  .rv-frame { position: relative; border: 1px solid #2c3440; border-radius: 6px; padding: 5px; display: grid; gap: 3px; font-size: 11.5px; }
  .rv-frame.hit { border-color: #f0913f; box-shadow: inset 0 0 0 2px #f0913f; }
  .rv-frame.miss { border-color: #f0626c; box-shadow: inset 0 0 0 2px #f0626c; }
  .rv-flags { position: absolute; top: -21px; left: 0; display: flex; gap: 3px; }
  .rv-t { font-family: ui-monospace, Menlo, monospace; font-weight: 600; }
  .rv-img { position: relative; transform: scaleX(-1); background: #000; border-radius: 4px; overflow: hidden; aspect-ratio: 4 / 3; }
  .rv-img.lost { transform: none; display: grid; place-items: center; color: #f0626c; font-size: 11px; }
  .rv-img img { width: 100%; height: 100%; object-fit: fill; display: block; }
  .rv-img svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .rv-row { display: flex; justify-content: space-between; font-family: ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; }
  .rv-row span:first-child { color: #9aa4b4; font-family: inherit; }
  .rv-row .ok { color: #45c08a; } .rv-row .ng { color: #f0626c; }
  .rv-state { text-align: center; font-size: 10.5px; font-weight: 700; padding: 2px 0; border-radius: 3px; background: #212834; color: #9aa4b4; }
  .rv-state.pressed { background: rgba(224,163,58,.18); color: #e0a33a; }
  .rv-table { border-collapse: collapse; font-size: 13px; min-width: 640px; width: 100%; }
  .rv-table th, .rv-table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #2c3440; white-space: nowrap; }
  .rv-table th { color: #9aa4b4; font-weight: 500; font-size: 12px; }
  .rv-table tr.has-miss td:first-child { box-shadow: inset 3px 0 0 #f0626c; }
  .rv-table .mono { font-family: ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; }
  .rv-link { font: inherit; background: none; border: 0; padding: 0; color: #f0913f; text-decoration: underline; cursor: pointer; }
  .rv-link.ng { color: #f0626c; }
  @media (max-width: 640px) { .rv-kpis { grid-template-columns: repeat(2, minmax(0,1fr)); } }
  `;
  const style = document.createElement("style");
  style.id = "rec-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
