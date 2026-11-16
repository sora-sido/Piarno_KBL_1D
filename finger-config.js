/**
 * 指の定義と指別の判定定数（DOM 非依存）
 * ブラウザ（main.js）と Node（tools/replay-dataset.mjs）の両方から使う。
 */

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

// 指ごとの推奨平滑化下降速度閾値（ピクセル/秒）
// 打鍵時は急峻な下降（300〜1600 px/s）が発生し、静止待機時（0〜8 px/s）を完全に遮断
export const FINGER_VY_THRESHOLDS = {
  THUMB: 160,
  INDEX: 220,
  MIDDLE: 220,
  RING: 180,
  PINKY: 180
};
