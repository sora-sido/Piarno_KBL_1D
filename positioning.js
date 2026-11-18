/**
 * 手の位置合わせ（positioning.js）
 *
 * カメラ起動後、演奏を始める前に「右手を置くべき場所」を枠で表示し、
 * 検出した右手が判定しやすい位置・大きさにあるかを毎フレーム確かめる。
 * 良い位置で約1秒止まると自動で演奏（カウントダウン）へ進む。
 * 演奏中も同じ基準で位置を確かめ、小窓のカメラの枠の色で知らせる。
 *
 * 座標はすべて「画面に見えている向き」（左右反転後）の 0〜1 で扱う。
 *
 * 想定するカメラの置き方：スマホ／iPad を手の正面・机の高さに立て、手を正面から写す。
 * このとき手は「横に広く、縦に短く」写る（指の付け根が上、指先が机に向かって下がる）。
 * 打鍵の録画データでも、指の付け根は画面の高さの約0.45〜0.55、指先は約0.6にあった。
 */

// 右手を置く目標の枠（画面上の割合）。手の中心がこの枠の中心付近、手の高さが枠の高さに近いのが理想
export const TARGET_BOX = { x: 0.14, y: 0.24, w: 0.72, h: 0.56 };
export const DESK_LINE_Y = 0.80; // 机の線（枠の下辺）
const CENTER_TOL_X = 0.16;     // 手の中心と枠の中心の許容ずれ（横）
const CENTER_TOL_Y = 0.20;     // 同（縦）。机に手を置いたままでも合うよう広めにとる
const SIZE_MIN = 0.30;         // 手の横幅が画面の幅に占める割合の下限
const SIZE_MAX = 0.88;         // 同・上限
const EDGE_MARGIN = 0.02;      // 指先が画面の端からはみ出していないかの余白
const HOLD_MS = 1000;          // 良い位置でこの時間止まったら決定

const state = {
  active: false,
  onDone: null,
  goodSince: null,
  lastResult: null,
  el: null,
  reference: null   // 位置合わせが終わった時点の手の範囲（演奏中のずれの基準）
};

// 演奏中、最初の位置からどれだけずれたら知らせるか
// 演奏中の警告は演奏の邪魔にならないよう緩め（細かいずれでは知らせない）
const DRIFT_TOL_X = 0.15;
const DRIFT_TOL_Y = 0.16;
const DRIFT_SCALE = 0.40;   // 手の横幅が最初より±40%以上変わったら（近づいた／離れた）

export function getReferenceBox() {
  return state.reference;
}

/**
 * 演奏中：位置合わせで決めた最初の手の位置からのずれを評価する
 */
export function evaluateDrift(landmarks) {
  const ref = state.reference;
  const base = evaluateHandPosition(landmarks);
  if (!ref || !base.box) return { ...base, ref };
  const b = base.box;
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const rcx = (ref.minX + ref.maxX) / 2, rcy = (ref.minY + ref.maxY) / 2;
  const scale = (b.maxX - b.minX) / Math.max(0.01, ref.maxX - ref.minX);
  let code = "ok", message = "最初の位置のままです", dir = null;
  if (scale > 1 + DRIFT_SCALE) { code = "closer"; dir = "away"; message = "最初よりカメラに近づいています。少し離してください"; }
  else if (scale < 1 - DRIFT_SCALE) { code = "farther"; dir = "closer"; message = "最初よりカメラから離れています。少し近づけてください"; }
  else if (cx - rcx > DRIFT_TOL_X) { code = "right"; dir = "left"; message = "最初の位置より右にずれています。手を左へ戻してください"; }
  else if (rcx - cx > DRIFT_TOL_X) { code = "left"; dir = "right"; message = "最初の位置より左にずれています。手を右へ戻してください"; }
  else if (cy - rcy > DRIFT_TOL_Y) { code = "down"; dir = "up"; message = "最初の位置より下にずれています。手を少し上へ"; }
  else if (rcy - cy > DRIFT_TOL_Y) { code = "up"; dir = "down"; message = "最初の位置より上にずれています。手を少し下へ"; }
  return { ok: code === "ok", code, dir, message, box: b, ref };
}

/**
 * 手の位置を評価する（演奏中の小窓の枠の色にも使う）
 * landmarks: MediaPipe の右手21点（正規化座標・左右反転前）、未検出なら null
 */
export function evaluateHandPosition(landmarks) {
  if (!landmarks) {
    return { ok: false, code: "nohand", dir: "nohand", message: "右手が見えていません。カメラに右手の甲を向けて、枠の中に入れてください" };
  }
  const xs = landmarks.map((p) => 1 - p.x);
  const ys = landmarks.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const width = maxX - minX;
  const boxCx = TARGET_BOX.x + TARGET_BOX.w / 2, boxCy = TARGET_BOX.y + TARGET_BOX.h / 2;
  const checks = {
    visible: minX > EDGE_MARGIN && maxX < 1 - EDGE_MARGIN && minY > EDGE_MARGIN && maxY < 1 - EDGE_MARGIN,
    centerX: Math.abs(cx - boxCx) <= CENTER_TOL_X,
    centerY: Math.abs(cy - boxCy) <= CENTER_TOL_Y,
    size: width >= SIZE_MIN && width <= SIZE_MAX
  };
  let code = "ok", message = "良い位置です。そのまま止めてください", dir = null;
  if (width > SIZE_MAX) { code = "tooBig"; dir = "away"; message = "手がカメラに近すぎます。少し離してください"; }
  else if (width < SIZE_MIN) { code = "tooSmall"; dir = "closer"; message = "手が小さく写っています。もう少しカメラに近づけてください"; }
  else if (!checks.centerX) { code = "x"; dir = cx < boxCx ? "right" : "left"; message = cx < boxCx ? "手をもう少し右へ動かしてください" : "手をもう少し左へ動かしてください"; }
  else if (!checks.centerY) { code = "y"; dir = cy < boxCy ? "down" : "up"; message = cy < boxCy ? "手をもう少し下へ動かしてください" : "手をもう少し上へ動かしてください"; }
  else if (!checks.visible) { code = "edge"; dir = "center"; message = "指先が画面の端で切れています。手を枠の中央へ"; }
  return { ok: code === "ok", code, dir, message, checks, box: { minX, maxX, minY, maxY } };
}

/**
 * 動かす方向を大きな矢印で表す（位置合わせ画面と演奏中の両方で使う）
 * dir: left / right / up / down / closer / away / center / nohand / ok
 */
const DIR_LABEL = {
  left: "左へ", right: "右へ", up: "上へ", down: "下へ",
  closer: "カメラに近づける", away: "カメラから離す", center: "枠の中央へ", nohand: "右手を映す", ok: "OK"
};
export function directionGraphic(dir) {
  const arrow = (rot) => `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(${rot} 50 50)">
      <path d="M50 8 L88 50 L64 50 L64 92 L36 92 L36 50 L12 50 Z" fill="currentColor"/></g></svg>`;
  const corners = (outward) => {
    const tri = (rot) => `<g transform="rotate(${rot} 50 50)"><path d="${outward ? "M6 6 L40 6 L6 40 Z" : "M40 40 L40 12 L12 40 Z"}" fill="currentColor"/></g>`;
    return `<svg viewBox="0 0 100 100" aria-hidden="true">${tri(0)}${tri(90)}${tri(180)}${tri(270)}
      <rect x="34" y="34" width="32" height="32" rx="6" fill="none" stroke="currentColor" stroke-width="6"/></svg>`;
  };
  let svg;
  switch (dir) {
    case "up": svg = arrow(0); break;
    case "right": svg = arrow(90); break;
    case "down": svg = arrow(180); break;
    case "left": svg = arrow(270); break;
    case "closer": svg = corners(true); break;
    case "away": svg = corners(false); break;
    case "ok": svg = `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M18 52 L42 76 L84 26" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>`; break;
    default: svg = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" stroke-width="10"/><circle cx="50" cy="50" r="8" fill="currentColor"/></svg>`;
  }
  return `<div class="dir-icon">${svg}</div><div class="dir-label">${DIR_LABEL[dir] || ""}</div>`;
}

// 位置合わせ画面の一言
const SHORT_MSG = {
  left: "もう少し左へ", right: "もう少し右へ", up: "もう少し上へ", down: "もう少し下へ",
  closer: "もう少し近づけて", away: "もう少し離して", center: "枠の中央へ", nohand: "右手を枠に入れてください"
};

export function isPositioning() {
  return state.active;
}

/**
 * 位置合わせ画面を開く。container は映像コンテナ（枠を重ねる）
 */
export function startPositioning(container, onDone) {
  injectStyles();
  state.active = true;
  state.onDone = onDone;
  state.goodSince = null;
  state.finishing = false;
  document.body.classList.add("positioning");
  if (state.el) state.el.remove();

  const el = document.createElement("div");
  el.className = "pos-overlay";
  el.innerHTML = `
    <svg class="pos-frame" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <rect class="pos-box" x="${TARGET_BOX.x * 100}" y="${TARGET_BOX.y * 100}" width="${TARGET_BOX.w * 100}" height="${TARGET_BOX.h * 100}" rx="3" ry="3"/>
      <rect class="pos-hand" x="0" y="0" width="0" height="0" rx="1.5" ry="1.5"/>
      <line class="pos-desk" x1="4" x2="96" y1="${DESK_LINE_Y * 100}" y2="${DESK_LINE_Y * 100}"/>
    </svg>
    <svg class="pos-silhouette" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"
      style="left:${TARGET_BOX.x * 100}%;top:${TARGET_BOX.y * 100}%;width:${TARGET_BOX.w * 100}%;height:${TARGET_BOX.h * 100}%">
      <!-- 正面から見た右手（画面では親指が左）：手の甲の帯と、机に向かって下がる5本の指 -->
      <rect x="14" y="6" width="74" height="16" rx="8"/>
      <rect x="8" y="18" width="12" height="30" rx="6" transform="rotate(-18 14 18)"/>
      <rect x="27" y="16" width="12" height="40" rx="6"/>
      <rect x="42" y="14" width="12" height="44" rx="6"/>
      <rect x="57" y="16" width="12" height="41" rx="6"/>
      <rect x="72" y="18" width="11" height="34" rx="5.5"/>
    </svg>
    </svg>`;
  const dirEl = document.createElement("div");
  dirEl.className = "dir-badge pos-dir";
  el.appendChild(dirEl);
  container.appendChild(el);

  const panel = document.createElement("div");
  panel.className = "pos-panel";
  panel.setAttribute("role", "status");
  panel.innerHTML = `
    <div class="pos-msg" id="pos-msg">右手を枠に入れてください</div>
    <div class="pos-actions">
      <button type="button" class="pos-btn" id="pos-skip">この位置で始める</button>
    </div>
    <div class="pos-bar"><span id="pos-bar-fill"></span></div>`;
  document.body.appendChild(panel);
  state.el = el;
  state.panel = panel;
  panel.querySelector("#pos-skip").addEventListener("click", () => finish());
}

/**
 * 推論1コマごとに呼ぶ（位置合わせ中のみ処理）
 */
export function updatePositioning(landmarks) {
  if (!state.active || !state.el) return;
  const r = evaluateHandPosition(landmarks);
  state.lastResult = r;
  const panel = state.panel;
  if (state.finishing) return;
  // 表示は短い一言だけ（向きは大きな矢印でも示す）
  panel.querySelector("#pos-msg").textContent = r.ok ? "そのまま止めて" : (SHORT_MSG[r.dir] || "右手を枠に入れてください");

  const handRect = state.el.querySelector(".pos-hand");
  if (r.box) {
    handRect.setAttribute("x", r.box.minX * 100);
    handRect.setAttribute("y", r.box.minY * 100);
    handRect.setAttribute("width", (r.box.maxX - r.box.minX) * 100);
    handRect.setAttribute("height", (r.box.maxY - r.box.minY) * 100);
    handRect.style.display = "";
  } else {
    handRect.style.display = "none";
  }
  state.el.classList.toggle("good", r.ok);
  const dirEl = state.el.querySelector(".pos-dir");
  const dir = r.ok ? "ok" : r.dir;
  if (dirEl.dataset.dir !== dir) {
    dirEl.dataset.dir = dir;
    dirEl.innerHTML = directionGraphic(dir);
    dirEl.classList.toggle("ok", r.ok);
  }

  const now = performance.now();
  if (r.ok) {
    if (state.goodSince === null) state.goodSince = now;
    const p = Math.min(1, (now - state.goodSince) / HOLD_MS);
    panel.querySelector("#pos-bar-fill").style.width = `${p * 100}%`;
    if (p >= 1) {
      // 決まった一言を少し見せてから演奏へ
      panel.querySelector("#pos-msg").textContent = "OK！この位置のまま弾いてください";
      state.finishing = true;
      setTimeout(() => { state.finishing = false; finish(); }, 800);
    }
  } else {
    state.goodSince = null;
    panel.querySelector("#pos-bar-fill").style.width = "0%";
  }
}

function finish() {
  if (!state.active) return;
  state.active = false;
  // この時点の手の位置を、演奏中のずれの基準として覚える（手が見えていなければ目標の枠を基準に）
  state.reference = state.lastResult && state.lastResult.box ? { ...state.lastResult.box } : {
    minX: TARGET_BOX.x, maxX: TARGET_BOX.x + TARGET_BOX.w, minY: TARGET_BOX.y, maxY: TARGET_BOX.y + TARGET_BOX.h
  };
  document.body.classList.remove("positioning");
  const el = state.el, panel = state.panel;
  state.el = null;
  state.panel = null;
  setTimeout(() => { el && el.remove(); panel && panel.remove(); }, 250);
  if (state.onDone) state.onDone();
}

function injectStyles() {
  if (document.getElementById("pos-styles")) return;
  const style = document.createElement("style");
  style.id = "pos-styles";
  style.textContent = `
  .pos-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 5; }
  .pos-frame { position: absolute; inset: 0; width: 100%; height: 100%; }
  .pos-box { fill: none; stroke: rgba(255,255,255,.85); stroke-width: .5; stroke-dasharray: 2 1.4; vector-effect: non-scaling-stroke; }
  .pos-overlay .pos-box { stroke-width: 3px; }
  .pos-overlay.good .pos-box { stroke: #3ddc84; stroke-dasharray: none; }
  .pos-hand { fill: rgba(0,229,255,.08); stroke: #00e5ff; stroke-width: 2px; vector-effect: non-scaling-stroke; }
  .pos-overlay.good .pos-hand { stroke: #3ddc84; fill: rgba(61,220,132,.10); }
  .pos-silhouette { position: absolute; opacity: .62; }
  .pos-silhouette rect { fill: rgba(254,220,189,.55); stroke: #ffffff; stroke-width: 1.6px; vector-effect: non-scaling-stroke; }
  .pos-overlay.good .pos-silhouette rect { fill: rgba(61,220,132,.45); stroke: #3ddc84; }
  .pos-desk { stroke: rgba(255,255,255,.55); stroke-width: 2px; vector-effect: non-scaling-stroke; }
  .pos-hint { font-size: 12px; color: #9aa4b4; line-height: 1.5; }
  .pos-overlay.good .pos-silhouette { opacity: .75; }
  .pos-hint b { color: #fff; }
  .pos-panel { position: fixed; left: 50%; transform: translateX(-50%); top: calc(56px + env(safe-area-inset-top, 0px));
    width: min(520px, calc(100vw - 24px)); background: rgba(12,14,18,.88); color: #fff; border: 1px solid #333; border-radius: 12px;
    padding: 10px 14px; z-index: 500; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 6px 12px; font-size: 14px; align-items: center; }
  .pos-panel > .pos-title, .pos-panel > .pos-hint, .pos-panel > .pos-checks, .pos-panel > .pos-bar, .pos-panel > .pos-rule { grid-column: 1 / -1; }
  .pos-rule { font-size: 13px; line-height: 1.5; color: #ffd23f; }
  .pos-rule b { color: #fff; }
  .dir-badge { display: grid; justify-items: center; gap: 4px; color: #ffd23f; pointer-events: none;
    filter: drop-shadow(0 2px 8px rgba(0,0,0,.7)); }
  .dir-badge.ok { color: #3ddc84; }
  .dir-badge .dir-icon { width: clamp(90px, 22vmin, 170px); height: clamp(90px, 22vmin, 170px); }
  .dir-badge .dir-icon svg { width: 100%; height: 100%; display: block; }
  .dir-badge .dir-label { font-size: clamp(16px, 3.2vmin, 28px); font-weight: 800; color: #fff; background: rgba(0,0,0,.55);
    padding: 2px 12px; border-radius: 999px; white-space: nowrap; }
  .pos-dir { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 6; }
  @media (max-height: 500px) { .pos-panel { left: 12px; transform: none; width: min(360px, 45vw); } .pos-hint { display: none; } }
  .pos-title { font-weight: 700; font-size: 15px; }
  .pos-msg { font-size: 17px; font-weight: 700; line-height: 1.4; min-width: 0; grid-column: 1; grid-row: 1; }
  .pos-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
  .pos-checks li { font-size: 12px; padding: 3px 8px; border-radius: 999px; background: #222; color: #888; }
  .pos-checks li::before { content: "・"; }
  .pos-checks li.ok { background: rgba(61,220,132,.16); color: #3ddc84; }
  .pos-checks li.ok::before { content: "✓ "; }
  .pos-bar { height: 4px; border-radius: 2px; background: #222; overflow: hidden; }
  .pos-bar span { display: block; height: 100%; width: 0; background: #3ddc84; transition: width .1s linear; }
  .pos-actions { display: flex; justify-content: flex-end; grid-column: 2; grid-row: 1; }
  .pos-btn { font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 8px; border: 1px solid #555; background: transparent; color: #ddd; cursor: pointer; }
  .pos-btn:focus-visible { outline: 2px solid #00e5ff; outline-offset: 2px; }
  `;
  document.head.appendChild(style);
}
