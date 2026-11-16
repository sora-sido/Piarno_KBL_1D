/**
 * 指別打鍵閾値モデル（DOM 非依存）
 *
 * CSV データセットのパースと、統計量からの打鍵閾値導出を行う。
 * ブラウザ（main.js）と Node（tools/replay-dataset.mjs）の両方から使う。
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
 * 特定指のデータセットから打鍵閾値を導出（負値変位・各指の可動域に対応）
 * @param {Array<{ filename: string, frames: Array<{ ry: number, isHit: boolean }> }>} datasets
 * @param {string} fingerKey
 * @returns {{ hitRy: number, liftRy: number, samples: number, maxAirRy: number } | null} データが無ければ null
 */
export function deriveFingerThreshold(datasets, fingerKey) {
  if (!datasets || datasets.length === 0) return null;

  const frames = datasets.flatMap((d) => d.frames);
  if (frames.length === 0) return null;

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

      // 速度ゲートにより机面待機誤爆が防止されているため、浅い打鍵でも確実に反応するよう適正範囲内にクランプ
      const minHitTh = fingerKey === "THUMB" ? 0.30 : (fingerKey === "PINKY" ? 0.45 : 0.50);
      hitTh = Math.max(hitTh, minHitTh);

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

  return {
    hitRy: parseFloat(hitTh.toFixed(2)),
    liftRy: parseFloat(liftTh.toFixed(2)),
    samples,
    maxAirRy
  };
}
