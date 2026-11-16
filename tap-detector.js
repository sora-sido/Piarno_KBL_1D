/**
 * 打鍵判定コア（DOM 非依存）
 *
 * カメラ 1 フレーム分の右手ランドマークを受け取り、平滑化・特徴量（ry / tipVy）の算出・
 * 打鍵ステートの更新までを行う。ブラウザ（main.js）と Node（tools/replay-dataset.mjs）の
 * 両方から同じコードを使うため、DOM・音声・楽曲進行には一切触れない。
 */

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

// TOUCHED 中の早期リフト復帰（リバウンド）判定：上向き速度と、打鍵閾値からの抜け幅
export const REBOUND_VY = -100;
export const REBOUND_RY_MARGIN = 0.02;

// ry の分母（手首〜付け根の距離）の下限：画面高に対する比
export const MIN_BASE_DIST_RATIO = 0.05;

/**
 * 打鍵判定器
 *
 * update() を毎フレーム 1 回呼ぶ。戻り値の event が "HIT" のフレームで発音・進行を行う。
 */
export class TapDetector {
  constructor() {
    // 手の全21ランドマーク用フィルター（実際に通すのは手首＋対象指4関節の5点のみ）
    this.landmarkFilters = Array.from({ length: 21 }, () => new PointFilter(1.2, 0.008));
    // 平滑化座標のオブジェクトプール（毎フレームの生成・破棄を避ける）
    this.smoothed = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
    this.lostFrames = 0;
    this.hasValidSmoothed = false;
    this.lastRawLandmarks = null;
    this.lastFilteredFingerKey = null;
    // 打鍵ステート（IDLE: 待機, TOUCHED: 机面接触中・リフト待ち）
    this.tapState = "IDLE";
  }

  /** 打鍵ステートを待機へ戻す（カウントダウン開始時など） */
  resetTapState() {
    this.tapState = "IDLE";
  }

  /** 対象指の現在の打鍵ステート */
  getTapState() {
    return this.tapState;
  }

  /**
   * 1 フレーム分の更新
   * @param {Array<{x:number,y:number}>|null} hand 選択済み右手の正規化ランドマーク（未検出時は null）
   * @param {object} p
   * @param {number} p.now タイムスタンプ（ms）
   * @param {number} p.width Canvas 幅（px）
   * @param {number} p.height Canvas 高（px）
   * @param {string} p.fingerKey 対象指キー
   * @param {object} p.finger 対象指の定義（baseIdx, p1Idx, p2Idx, p3Idx, tipIdx）
   * @param {number} p.hitRy 打鍵閾値
   * @param {number} p.liftRy リフト閾値
   * @param {number} p.vyTh 下降速度閾値（px/s）
   * @param {boolean} p.gateOpen false の間は HIT を判定しない（カウントダウン・完走演出中）
   * @returns {{tracking:"LOST"|"HOLD"|"TRACKING", event:"HIT"|"LIFT"|null, landmarks:Array|null,
   *            isReacquired:boolean, ry:number, vy:number, smoothed:Array, stateReset:boolean}}
   */
  update(hand, p) {
    const cfg = p.finger;
    const activeJointIndices = [0, cfg.p1Idx, cfg.p2Idx, cfg.p3Idx, cfg.tipIdx];
    const hasHand = hand !== null && hand !== undefined;

    if (!hasHand) {
      this.lostFrames++;
      if (this.lostFrames <= MAX_LOST_FRAMES && this.hasValidSmoothed) {
        // 直前の平滑化座標でフィルターを空回しし、復帰時の dt 拡大による速度スパイクを防ぐ
        for (const i of activeJointIndices) {
          const pt = this.smoothed[i];
          this.landmarkFilters[i].filter(pt.x, pt.y, p.now, pt);
        }
      } else {
        // 完全ロスト：ステート・フィルター・追従情報を全リセット
        const stateReset = this.tapState !== "IDLE";
        this.tapState = "IDLE";
        this.landmarkFilters.forEach((f) => f.reset());
        this.hasValidSmoothed = false;
        this.lastRawLandmarks = null;
        this.lastFilteredFingerKey = null;
        return {
          tracking: "LOST", event: null, landmarks: null, isReacquired: false,
          ry: NaN, vy: 0, smoothed: this.smoothed, stateReset
        };
      }
    } else {
      this.lostFrames = 0;
    }

    // 画面外（完全未検出）からの再出現初フレームか
    const isReacquired = hasHand && !this.hasValidSmoothed;

    const landmarks = hasHand ? hand : this.lastRawLandmarks;
    if (!landmarks) {
      return {
        tracking: "LOST", event: null, landmarks: null, isReacquired: false,
        ry: NaN, vy: 0, smoothed: this.smoothed, stateReset: false
      };
    }
    this.lastRawLandmarks = landmarks;

    if (hasHand) {
      const isFingerChanged = this.lastFilteredFingerKey !== p.fingerKey;
      if (isReacquired || isFingerChanged) {
        // 画面外復帰または指切り替え初フレーム：新座標で即座にスナップ初期化
        for (const i of activeJointIndices) {
          const raw = landmarks[i];
          this.landmarkFilters[i].snap(raw.x * p.width, raw.y * p.height, p.now, this.smoothed[i]);
        }
        this.lastFilteredFingerKey = p.fingerKey;
      } else {
        for (const i of activeJointIndices) {
          const raw = landmarks[i];
          this.landmarkFilters[i].filter(raw.x * p.width, raw.y * p.height, p.now, this.smoothed[i]);
        }
      }
      this.hasValidSmoothed = true;
    }

    // 特徴量：相対変位 ry と指先下降速度 vy
    const smoothWrist = this.smoothed[0];
    const smoothBase = this.smoothed[cfg.baseIdx];
    const smoothTip = this.smoothed[cfg.tipIdx];
    const baseDistPx = Math.hypot(smoothBase.x - smoothWrist.x, smoothBase.y - smoothWrist.y);
    const safeBaseDistPx = Math.max(baseDistPx, p.height * MIN_BASE_DIST_RATIO);
    const ry = (smoothTip.y - smoothBase.y) / safeBaseDistPx;
    const vy = this.landmarkFilters[cfg.tipIdx].getVelocityY();

    // ステート更新
    let event = null;
    if (this.tapState === "IDLE" && p.gateOpen && !isReacquired) {
      if (ry >= p.hitRy && vy >= p.vyTh) {
        this.tapState = "TOUCHED";
        event = "HIT";
      }
    } else if (this.tapState === "TOUCHED") {
      const isLiftByPosition = ry <= p.liftRy;
      const isLiftByRebound = vy <= REBOUND_VY && ry <= p.hitRy - REBOUND_RY_MARGIN;
      if (isLiftByPosition || isLiftByRebound) {
        this.tapState = "IDLE";
        event = "LIFT";
      }
    }

    return {
      tracking: hasHand ? "TRACKING" : "HOLD", event, landmarks, isReacquired,
      ry, vy, smoothed: this.smoothed, stateReset: false
    };
  }
}
