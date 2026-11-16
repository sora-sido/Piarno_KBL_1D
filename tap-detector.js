/**
 * 打鍵判定コア（DOM 非依存）
 *
 * カメラ 1 フレーム分の右手ランドマークを受け取り、平滑化・特徴量の算出・
 * 打鍵ステートの更新までを行う。ブラウザ（main.js）と Node（tools/replay-dataset.mjs）の
 * 両方から同じコードを使うため、DOM・音声・楽曲進行には一切触れない。
 */

import { FINGER_CONFIGS } from "./finger-config.js";

/**
 * 1 Euro Filter（ワンユーロフィルター）
 * 低速時はジッター（微小な震え）を平滑化し、高速打鍵時は遅延を抑えて追従する適応フィルター
 */
export class OneEuroFilter {
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

    // 速度に応じた動的カットオフ周波数
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
export class PointFilter {
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
   */
  snap(x, y, timestamp, out = null) {
    this.reset(x, y, timestamp);
    if (out) {
      out.x = x;
      out.y = y;
      return out;
    }
    return { x, y };
  }

  filter(x, y, timestamp, out = null) {
    const fx = this.xf.filter(x, timestamp);
    const fy = this.yf.filter(y, timestamp);
    if (out) {
      out.x = fx;
      out.y = fy;
      return out;
    }
    return { x: fx, y: fy };
  }

  /**
   * 平滑化されたY軸下降速度（ピクセル/秒）。下向き移動時は正、上向き移動時は負
   */
  getVelocityY() {
    return this.yf.dxPrev;
  }
}

// 一時的な検出ロストを直前の平滑化座標で補う最大フレーム数（超えたら全リセット）
export const MAX_LOST_FRAMES = 6;

// ---- 判定パラメータ（すべて「手の基準長 L に対する比」。解像度や手とカメラの距離に依存しない） ----

// 打鍵の開始：直近 STROKE_WINDOW_MS の最小値から ry がこれだけ沈んだら打鍵の動きとみなす。
// 固定の高さ（旧 hitRy）ではなく沈み込み量で見るので、手の姿勢や構え方が変わっても同じ感度になる
export const STROKE_ONSET_RY = 0.20;
export const STROKE_WINDOW_MS = 400;
// 打鍵の開始：ry の下降速度の下限（L/秒）。付け根に対する相対速度なので、手全体の上下動では上がらない
export const STROKE_MIN_VELOCITY = 1.5;
// 離鍵（TOUCHED → IDLE）：打鍵後に到達したピークから ry がこれだけ下がったら離鍵とみなす。
// 固定の閾値まで戻る必要がないので、指を浅く上げただけの連打でも次の打鍵を受け付ける
export const RELEASE_DROP_RY = 0.12;
// 離鍵は指先の下降が止まってから（ry の速度がこの値以下）。下降の途中で ry が揺れても離鍵とみなさないので、
// 1 回の打鍵で 2 回鳴る二重検出を防ぐ
export const RELEASE_MAX_VELOCITY = 0;

// 机面への接触の確認：打鍵の瞬間、指先は手首より下（画面の下側）にある。空中で指を動かしただけの
// ときは指先が手首より上にあるので、(指先.y − 手首.y) ÷ L がこの値以上のときだけ打鍵とする
export const CONTACT_MIN = 0.0;
// 指先そのものが画面上で下降していること：付け根や手首のランドマークが揺れただけでは ry が変化しても
// 指先は動かない。直近 STROKE_WINDOW_MS の指先の下降量（÷L）と、直近 TIP_SPEED_WINDOW_MS の
// 指先の最大下降速度（L/秒）に下限を設ける
export const TIP_STROKE_MIN = 0.15;
export const TIP_SPEED_MIN = 3.0;
export const TIP_SPEED_WINDOW_MS = 150;
// 手を一時的に見失った直後は、戻ったランドマークの位置が飛ぶことがある。
// 最後に見失ってからこの時間は HIT を判定しない
export const LOSS_HOLDOFF_MS = 100;

// 連動の抑制：ある指を叩くと隣の指もつられて沈む。対象指は HIT の直後に次の指へ切り替わるので、
// そのままだと 1 回の打鍵で 2 音進んでしまう。次の 2 つで防ぐ
// (1) HIT の直後はこの時間だけ次の HIT を受け付けない（つられた指の動きが止まるのを待つ）
export const HIT_LOCKOUT_MS = 100;
// (2) 対象指の下降速度が、ほかの指の最大下降速度のこの割合に満たなければ打鍵としない
//     （ほかの指を叩いたときのつられた動きは、叩いた指より遅い）
export const DOMINANCE_RATIO = 0.5;

// 手の基準長 L：手首〜付け根の距離の、直近 SCALE_WINDOW_MS の中央値。
// 低いカメラ位置では手首と付け根が重なって瞬間値が大きく揺れるため、時間方向の中央値で安定させる
export const SCALE_WINDOW_MS = 2000;
// L の下限：画面高に対する比
export const MIN_BASE_DIST_RATIO = 0.05;

// ry とその速度にかける軽い平滑化（1 次ローパス）のカットオフ周波数 [Hz]
export const FEATURE_CUTOFF_HZ = 6.0;
export const VELOCITY_CUTOFF_HZ = 6.0;
// 指先の位置と速度にかける平滑化のカットオフ周波数 [Hz]
export const TIP_CUTOFF_HZ = 7.0;
export const TIP_SPEED_CUTOFF_HZ = 8.0;

const FINGER_KEYS = Object.keys(FINGER_CONFIGS);

function lowpassAlpha(cutoffHz, dt) {
  const tau = 1.0 / (2 * Math.PI * cutoffHz);
  return 1.0 / (1.0 + tau / dt);
}

/**
 * 1 本の指の特徴量と打鍵ステート
 *
 * ry     : 付け根から指先までの縦の差 ÷ 手の基準長 L（下向きが正）。軽く平滑化した値
 * vel    : ry の速度（L/秒、下向きが正）
 * stroke : 直近 STROKE_WINDOW_MS の ry の最小値から、いまどれだけ沈んでいるか
 * contact: (指先.y − 手首.y) ÷ L。正なら指先が手首より下にある
 * tipStroke / tipSpeedPeak : 指先そのものの下降量（÷L）と、直近の最大下降速度（L/秒）
 */
class FingerTracker {
  constructor() {
    // 打鍵ステート（IDLE: 待機, TOUCHED: 机面接触中・リフト待ち）と、打鍵後に到達した ry のピーク
    this.state = "IDLE";
    this.peakRy = -Infinity;
    this.resetFeatures();
  }

  resetFeatures() {
    this.ry = null;
    this.vel = 0;
    this.stroke = 0;
    this.scale = 0;
    this.prevRawRy = null;
    this.prevTime = null;
    this.ryHistory = [];    // { t, v } 直近 STROKE_WINDOW_MS
    this.scaleHistory = []; // { t, v } 直近 SCALE_WINDOW_MS
    this.contact = 0;
    this.tipY = null;        // 平滑化した指先の y（px）
    this.tipSpeed = 0;       // 平滑化した指先の下降速度（px/s）
    this.prevRawTipY = null;
    this.tipStroke = 0;
    this.tipSpeedPeak = 0;
    this.tipHistory = [];      // { t, v } 直近 STROKE_WINDOW_MS
    this.tipSpeedHistory = []; // { t, v } 直近 TIP_SPEED_WINDOW_MS
  }

  resetState() {
    const wasTouched = this.state !== "IDLE";
    this.state = "IDLE";
    this.peakRy = -Infinity;
    return wasTouched;
  }

  /**
   * 生のピクセル座標から特徴量を更新
   * @param {{x:number,y:number}} wrist
   * @param {{x:number,y:number}} base 付け根（MCP）
   * @param {{x:number,y:number}} tip 指先
   * @param {number} now タイムスタンプ（ms）
   * @param {number} minScale L の下限（px）
   */
  updateFeatures(wrist, base, tip, now, minScale) {
    // 手の基準長 L（直近の中央値）
    const sh = this.scaleHistory;
    sh.push({ t: now, v: Math.hypot(base.x - wrist.x, base.y - wrist.y) });
    while (sh.length > 1 && now - sh[0].t > SCALE_WINDOW_MS) sh.shift();
    const sorted = sh.map((e) => e.v).sort((a, b) => a - b);
    this.scale = Math.max(sorted[sorted.length >> 1], minScale);

    const rawRy = (tip.y - base.y) / this.scale;
    if (this.ry === null) {
      this.ry = rawRy;
      this.vel = 0;
      this.tipY = tip.y;
      this.tipSpeed = 0;
    } else {
      const dt = Math.max((now - this.prevTime) / 1000, 0.001);
      const rawVel = (rawRy - this.prevRawRy) / dt;
      this.vel += lowpassAlpha(VELOCITY_CUTOFF_HZ, dt) * (rawVel - this.vel);
      this.ry += lowpassAlpha(FEATURE_CUTOFF_HZ, dt) * (rawRy - this.ry);
      const rawTipSpeed = (tip.y - this.prevRawTipY) / dt;
      this.tipSpeed += lowpassAlpha(TIP_SPEED_CUTOFF_HZ, dt) * (rawTipSpeed - this.tipSpeed);
      this.tipY += lowpassAlpha(TIP_CUTOFF_HZ, dt) * (tip.y - this.tipY);
    }
    this.prevRawRy = rawRy;
    this.prevRawTipY = tip.y;
    this.prevTime = now;

    // 机面への接触の目安：指先が手首よりどれだけ下にあるか
    this.contact = (tip.y - wrist.y) / this.scale;

    // 指先そのものの下降量と、直近の最大下降速度
    const th = this.tipHistory;
    th.push({ t: now, v: this.tipY });
    while (th.length > 1 && now - th[0].t > STROKE_WINDOW_MS) th.shift();
    let tipTop = Infinity;
    for (const e of th) if (e.v < tipTop) tipTop = e.v;
    this.tipStroke = (this.tipY - tipTop) / this.scale;
    const ts = this.tipSpeedHistory;
    ts.push({ t: now, v: this.tipSpeed });
    while (ts.length > 1 && now - ts[0].t > TIP_SPEED_WINDOW_MS) ts.shift();
    let speedPeak = -Infinity;
    for (const e of ts) if (e.v > speedPeak) speedPeak = e.v;
    this.tipSpeedPeak = speedPeak / this.scale;

    // 直近の最小値（谷）からの沈み込み量
    const rh = this.ryHistory;
    rh.push({ t: now, v: this.ry });
    while (rh.length > 1 && now - rh[0].t > STROKE_WINDOW_MS) rh.shift();
    let valley = Infinity;
    for (const e of rh) if (e.v < valley) valley = e.v;
    this.stroke = this.ry - valley;
  }
}

/**
 * 打鍵判定器
 *
 * update() を毎フレーム 1 回呼ぶ。戻り値の event が "HIT" のフレームで発音・進行を行う。
 * 特徴量は 5 本の指すべてについて常に更新するので、対象指が切り替わった瞬間に
 * 次の指がすでに下り始めていても、その動きを途中から拾える。
 */
export class TapDetector {
  constructor(opt = {}) {
    // 検証ツールから条件を変えて試せるよう、判定パラメータは上書き可能にしている
    this.opt = {
      strokeOnsetRy: STROKE_ONSET_RY,
      strokeMinVelocity: STROKE_MIN_VELOCITY,
      releaseDropRy: RELEASE_DROP_RY,
      releaseMaxVelocity: RELEASE_MAX_VELOCITY,
      hitLockoutMs: HIT_LOCKOUT_MS,
      dominanceRatio: DOMINANCE_RATIO,
      contactMin: CONTACT_MIN,
      tipStrokeMin: TIP_STROKE_MIN,
      tipSpeedMin: TIP_SPEED_MIN,
      lossHoldoffMs: LOSS_HOLDOFF_MS,
      ...opt
    };
    // 骨格描画用：手の全21ランドマークの 1 Euro Filter と平滑化座標のオブジェクトプール
    this.landmarkFilters = Array.from({ length: 21 }, () => new PointFilter(1.2, 0.008));
    this.smoothed = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
    this.lostFrames = 0;
    this.hasValidSmoothed = false;
    this.lastRawLandmarks = null;
    this.lastHitAt = -Infinity;
    this.lastLossAt = -Infinity;
    // 指ごとの特徴量と打鍵ステート
    this.fingers = {};
    for (const key of FINGER_KEYS) this.fingers[key] = new FingerTracker();
    // 生ピクセル座標の作業用オブジェクト（毎フレームの生成を避ける）
    this._wrist = { x: 0, y: 0 };
    this._base = { x: 0, y: 0 };
    this._tip = { x: 0, y: 0 };
  }

  /** 全指の打鍵ステートを待機へ戻す（カウントダウン開始時など）。TOUCHED の指があったら true */
  resetTapStates() {
    let hadTouched = false;
    for (const key of FINGER_KEYS) {
      if (this.fingers[key].resetState()) hadTouched = true;
    }
    return hadTouched;
  }

  /** 指定した指の現在の打鍵ステート */
  getTapState(fingerKey) {
    return this.fingers[fingerKey].state;
  }

  /**
   * 1 フレーム分の更新
   * @param {Array<{x:number,y:number}>|null} hand 選択済み右手の正規化ランドマーク（未検出時は null）
   * @param {object} p
   * @param {number} p.now タイムスタンプ（ms）
   * @param {number} p.width Canvas 幅（px）
   * @param {number} p.height Canvas 高（px）
   * @param {string} p.fingerKey 対象指キー
   * @param {boolean} p.gateOpen false の間は HIT を判定しない（カウントダウン・完走演出中）
   * @returns {{tracking:"LOST"|"HOLD"|"TRACKING", event:"HIT"|"LIFT"|null, state:"IDLE"|"TOUCHED",
   *            landmarks:Array|null, isReacquired:boolean, ry:number, vel:number, stroke:number,
   *            smoothed:Array, stateReset:boolean}}
   */
  update(hand, p) {
    const hasHand = hand !== null && hand !== undefined;

    if (!hasHand) {
      this.lostFrames++;
      this.lastLossAt = p.now;
      if (this.lostFrames <= MAX_LOST_FRAMES && this.hasValidSmoothed) {
        // 一時ロスト：描画用フィルターを直前の座標で空回しし、復帰時の dt 拡大による飛びを防ぐ。
        // 特徴量は更新しないので、ロスト中に新しい HIT は成立しない
        for (let i = 0; i < 21; i++) {
          const pt = this.smoothed[i];
          this.landmarkFilters[i].filter(pt.x, pt.y, p.now, pt);
        }
        const target = this.fingers[p.fingerKey];
        return {
          tracking: "HOLD", event: null, state: target.state, landmarks: this.lastRawLandmarks,
          isReacquired: false, ry: target.ry ?? NaN, vel: target.vel, stroke: target.stroke,
          smoothed: this.smoothed, stateReset: false
        };
      }
      // 完全ロスト：ステート・フィルター・特徴量を全リセット
      const stateReset = this.resetTapStates();
      this.landmarkFilters.forEach((f) => f.reset());
      for (const key of FINGER_KEYS) this.fingers[key].resetFeatures();
      this.hasValidSmoothed = false;
      this.lastRawLandmarks = null;
      return {
        tracking: "LOST", event: null, state: "IDLE", landmarks: null, isReacquired: false,
        ry: NaN, vel: 0, stroke: 0, smoothed: this.smoothed, stateReset
      };
    }
    this.lostFrames = 0;

    // 画面外（完全未検出）からの再出現初フレームか
    const isReacquired = !this.hasValidSmoothed;
    this.lastRawLandmarks = hand;

    // 描画用：全21点を平滑化（再出現初フレームは新座標で即座にスナップ初期化）
    for (let i = 0; i < 21; i++) {
      const raw = hand[i];
      if (isReacquired) {
        this.landmarkFilters[i].snap(raw.x * p.width, raw.y * p.height, p.now, this.smoothed[i]);
      } else {
        this.landmarkFilters[i].filter(raw.x * p.width, raw.y * p.height, p.now, this.smoothed[i]);
      }
    }
    this.hasValidSmoothed = true;

    // 判定用：5 本の指すべての特徴量を生座標から更新し、TOUCHED の指は離鍵を調べる
    const minScale = p.height * MIN_BASE_DIST_RATIO;
    const wrist = this._wrist;
    wrist.x = hand[0].x * p.width;
    wrist.y = hand[0].y * p.height;
    let event = null;
    for (const key of FINGER_KEYS) {
      const cfg = FINGER_CONFIGS[key];
      const f = this.fingers[key];
      const base = this._base;
      const tip = this._tip;
      base.x = hand[cfg.baseIdx].x * p.width;
      base.y = hand[cfg.baseIdx].y * p.height;
      tip.x = hand[cfg.tipIdx].x * p.width;
      tip.y = hand[cfg.tipIdx].y * p.height;
      f.updateFeatures(wrist, base, tip, p.now, minScale);

      if (f.state === "TOUCHED") {
        // 離鍵：打鍵後のピークから releaseDropRy 下がり、かつ下降が止まっていたら待機へ戻す
        if (f.ry > f.peakRy) f.peakRy = f.ry;
        if (f.peakRy - f.ry >= this.opt.releaseDropRy && f.vel <= this.opt.releaseMaxVelocity) {
          f.resetState();
          if (key === p.fingerKey) event = "LIFT";
        }
      }
    }

    // 打鍵：対象指だけを判定する（ほかの指の動きでは進まない）
    const target = this.fingers[p.fingerKey];
    if (
      target.state === "IDLE" && event === null && p.gateOpen && !isReacquired &&
      p.now - this.lastHitAt >= this.opt.hitLockoutMs &&
      p.now - this.lastLossAt >= this.opt.lossHoldoffMs
    ) {
      const isStroke = target.stroke >= this.opt.strokeOnsetRy && target.vel >= this.opt.strokeMinVelocity;
      const isTipDescending = target.tipStroke >= this.opt.tipStrokeMin && target.tipSpeedPeak >= this.opt.tipSpeedMin;
      const isOnDesk = target.contact >= this.opt.contactMin;
      if (isStroke && isTipDescending && isOnDesk) {
        // ほかの指の最大下降速度（つられた動きかどうかの判定用）
        let maxOtherVel = 0;
        for (const key of FINGER_KEYS) {
          if (key !== p.fingerKey && this.fingers[key].vel > maxOtherVel) maxOtherVel = this.fingers[key].vel;
        }
        if (target.vel >= this.opt.dominanceRatio * maxOtherVel) {
          target.state = "TOUCHED";
          target.peakRy = target.ry;
          this.lastHitAt = p.now;
          event = "HIT";
        }
      }
    }

    return {
      tracking: "TRACKING", event, state: target.state, landmarks: hand, isReacquired,
      ry: target.ry, vel: target.vel, stroke: target.stroke, smoothed: this.smoothed, stateReset: false
    };
  }
}
