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
const CENTER_TOL_X = 0.12;     // 手の中心と枠の中心の許容ずれ（横）
const CENTER_TOL_Y = 0.14;     // 同（縦）
const SIZE_MIN = 0.38;         // 手の横幅が画面の幅に占める割合の下限
const SIZE_MAX = 0.80;         // 同・上限
const EDGE_MARGIN = 0.02;      // 指先が画面の端からはみ出していないかの余白
const HOLD_MS = 1000;          // 良い位置でこの時間止まったら決定

const state = {
  active: false,
  onDone: null,
  goodSince: null,
  lastResult: null,
  el: null
};

/**
 * 手の位置を評価する（演奏中の小窓の枠の色にも使う）
 * landmarks: MediaPipe の右手21点（正規化座標・左右反転前）、未検出なら null
 */
export function evaluateHandPosition(landmarks) {
  if (!landmarks) {
    return { ok: false, code: "nohand", message: "右手が見えていません。カメラに右手の甲を向けて、枠の中に入れてください" };
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
  let code = "ok", message = "良い位置です。そのまま止めてください";
  if (width > SIZE_MAX) { code = "tooBig"; message = "手がカメラに近すぎます。少し離してください"; }
  else if (width < SIZE_MIN) { code = "tooSmall"; message = "手が小さく写っています。もう少しカメラに近づけてください"; }
  else if (!checks.centerX) { code = "x"; message = cx < boxCx ? "手をもう少し右へ動かしてください" : "手をもう少し左へ動かしてください"; }
  else if (!checks.centerY) { code = "y"; message = cy < boxCy ? "手をもう少し下へ動かしてください" : "手をもう少し上へ動かしてください"; }
  else if (!checks.visible) { code = "edge"; message = "指先が画面の端で切れています。手を枠の中央へ"; }
  return { ok: code === "ok", code, message, checks, box: { minX, maxX, minY, maxY } };
}

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
  container.appendChild(el);

  const panel = document.createElement("div");
  panel.className = "pos-panel";
  panel.setAttribute("role", "status");
  panel.innerHTML = `
    <div class="pos-title">右手の位置合わせ</div>
    <div class="pos-msg" id="pos-msg">右手を点線の枠に合わせてください</div>
    <div class="pos-hint">スマホを手の正面・机の高さに立て、指先が下の線（机）に届くように構えます</div>
    <ul class="pos-checks">
      <li data-k="hand">手が見えている</li>
      <li data-k="pos">枠の位置</li>
      <li data-k="size">大きさ</li>
      <li data-k="edge">指先まで写っている</li>
    </ul>
    <div class="pos-bar"><span id="pos-bar-fill"></span></div>
    <div class="pos-actions">
      <button type="button" class="pos-btn" id="pos-skip">この位置で始める</button>
    </div>`;
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
  panel.querySelector("#pos-msg").textContent = r.message;
  const set = (k, ok) => panel.querySelector(`li[data-k="${k}"]`).classList.toggle("ok", !!ok);
  set("hand", !!landmarks);
  set("pos", r.checks && r.checks.centerX && r.checks.centerY);
  set("size", r.checks && r.checks.size);
  set("edge", r.checks && r.checks.visible);

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

  const now = performance.now();
  if (r.ok) {
    if (state.goodSince === null) state.goodSince = now;
    const p = Math.min(1, (now - state.goodSince) / HOLD_MS);
    panel.querySelector("#pos-bar-fill").style.width = `${p * 100}%`;
    if (p >= 1) {
      panel.querySelector("#pos-msg").textContent = "OK！この位置で判定します";
      finish();
    }
  } else {
    state.goodSince = null;
    panel.querySelector("#pos-bar-fill").style.width = "0%";
  }
}

function finish() {
  if (!state.active) return;
  state.active = false;
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
  .pos-silhouette { position: absolute; opacity: .13; }
  .pos-silhouette rect { fill: #FEDCBD; }
  .pos-desk { stroke: rgba(255,255,255,.55); stroke-width: 2px; vector-effect: non-scaling-stroke; }
  .pos-hint { font-size: 12px; color: #9aa4b4; line-height: 1.5; }
  .pos-overlay.good .pos-silhouette { opacity: .12; }
  .pos-panel { position: fixed; left: 50%; transform: translateX(-50%); top: calc(56px + env(safe-area-inset-top, 0px));
    width: min(520px, calc(100vw - 24px)); background: rgba(12,14,18,.88); color: #fff; border: 1px solid #333; border-radius: 12px;
    padding: 10px 14px; z-index: 500; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 6px 12px; font-size: 14px; align-items: center; }
  .pos-panel > .pos-title, .pos-panel > .pos-hint, .pos-panel > .pos-checks, .pos-panel > .pos-bar { grid-column: 1 / -1; }
  @media (max-height: 500px) { .pos-panel { left: 12px; transform: none; width: min(360px, 45vw); } .pos-hint { display: none; } }
  .pos-title { font-weight: 700; font-size: 15px; }
  .pos-msg { font-size: 15px; line-height: 1.45; min-width: 0; }
  .pos-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
  .pos-checks li { font-size: 12px; padding: 3px 8px; border-radius: 999px; background: #222; color: #888; }
  .pos-checks li::before { content: "・"; }
  .pos-checks li.ok { background: rgba(61,220,132,.16); color: #3ddc84; }
  .pos-checks li.ok::before { content: "✓ "; }
  .pos-bar { height: 4px; border-radius: 2px; background: #222; overflow: hidden; }
  .pos-bar span { display: block; height: 100%; width: 0; background: #3ddc84; transition: width .1s linear; }
  .pos-actions { display: flex; justify-content: flex-end; grid-column: 2; grid-row: 2; }
  .pos-btn { font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 8px; border: 1px solid #555; background: transparent; color: #ddd; cursor: pointer; }
  .pos-btn:focus-visible { outline: 2px solid #00e5ff; outline-offset: 2px; }
  `;
  document.head.appendChild(style);
}
