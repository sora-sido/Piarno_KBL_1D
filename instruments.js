/**
 * 曲ごとの音色（ピアノ以外の楽器）
 *
 * 実際の楽器を 1 音ずつ録音したサンプル（public/samples/ に同梱）を Tone.Sampler で鳴らす。
 * 録音されていない高さの音は、近い音を少しずらして鳴らす（Tone.Sampler の機能）。
 * 曲を選んだときに、その曲で使う楽器だけを読み込む。
 *
 * synth を持つ楽器は、録音を使わずにシンセサイザーで音を作る（ファイルの読み込み不要）。
 *
 * 音源の出典（くわしくは public/samples/CREDITS.md）
 *  - violin / cello / trumpet / tuba：tonejs-instruments（Nicholaus Brosowsky, MIT）。録音は VSCO 2 Community Edition など
 *  - music_box / harpsichord：FluidR3_GM（Frank Wen）を midi-js-soundfonts（Benjamin Gleitzman）で mp3 にしたもの（CC BY 3.0）
 */
import * as Tone from "tone";

const BASE = `${import.meta.env?.BASE_URL ?? "/"}samples/`;

// ファイル名（例：As4, Cs3, Eb4）→ Tone.js の音名（A#4, C#3, Eb4）
function fileToNote(name) {
  return name.replace(/^([A-G])s(\d)$/, "$1#$2");
}
function urlsOf(files) {
  return Object.fromEntries(files.split(" ").map((f) => [fileToNote(f), `${f}.mp3`]));
}

const FLUID_SET = "A2 A3 A4 A5 A6 A7 C2 C3 C4 C5 C6 C7 Eb2 Eb3 Eb4 Eb5 Eb6 Eb7 Gb2 Gb3 Gb4 Gb5 Gb6 Gb7";

/** 楽器の定義：サンプル、余韻（release）、音量（dB） */
export const INSTRUMENTS = {
  violin: {
    label: "ヴァイオリン",
    files: "A3 A4 A5 A6 C4 C5 C6 C7 E4 E5 E6 G3 G4 G5 G6",
    release: 0.6, volume: -4
  },
  cello: {
    label: "チェロ",
    files: "A2 A3 A4 As2 As3 B2 B3 B4 C2 C3 C4 C5 Cs3 Cs4 D2 D3 D4 Ds2 Ds3 Ds4 E2 E3 E4 F2 F3 F4 Fs3 Fs4 G2 G3 G4 Gs2 Gs3 Gs4",
    release: 0.8, volume: -8
  },
  trumpet: {
    label: "トランペット",
    files: "A3 A5 As4 C4 C6 D5 Ds4 F3 F4 F5 G4",
    release: 0.3, volume: -4
  },
  tuba: {
    label: "チューバ",
    files: "As1 As2 As3 D3 D4 Ds2 F1 F2 F3",
    release: 0.3, volume: -6
  },
  music_box: {
    label: "オルゴール",
    files: FLUID_SET,
    release: 2.5, volume: -2
  },
  harpsichord: {
    label: "チェンバロ",
    files: FLUID_SET,
    release: 1.2, volume: -12
  },
  // 新宝島の鍵盤（シンセ）の音色。原曲の録音から鍵盤のパートを音源分離（Demucs htdemucs_6s の「other」）で取り出し、
  // Aメロのリフ（28〜60 秒・59 音）を測った値に合わせて作ったもの。録音そのものは使っていない
  //  - 倍音：第2倍音が第1倍音より +6dB 強く、第3・4倍音は −4〜−6dB、第5倍音から上は −17〜−51dB と急に弱い
  //  - 音量の形：叩いた瞬間に最大（10ms 以内）→ 100ms 後に約 −8dB → 8 分音符ほどで減衰
  //  - 明るさ：鳴り始めが少し明るく、伸ばすうちに暗くなる（スペクトル重心 / 基本周波数 4.05 → 3.34）
  //  - 左右の広がりが大きい（左右の相関 0.12）→ 2 つの声を少しずらして左右に振り、コーラスで広げる
  //  同じリフをこのシンセで鳴らして同じ方法で測ると、第2〜10倍音の強さの差は平均 1.2dB、左右の相関 0.07
  shin_keys: {
    label: "新宝島の鍵盤",
    volume: -6,
    synth: {
      partials: [0.479, 1.0, 0.243, 0.309, 0.017, 0.068, 0.031, 0.027, 0.012, 0.006, 0.005, 0.004, 0.002, 0.003, 0.002, 0.001],
      envelope: { attack: 0.004, decay: 0.12, sustain: 0.4, release: 0.15 },
      filter: { type: "lowpass", Q: 1, rolloff: -12 },
      filterEnvelope: { attack: 0.003, decay: 0.2, sustain: 0.75, release: 0.15, baseFrequency: 2600, octaves: 1.4 },
      detune: 7,
      pan: 0.8,
      chorus: { frequency: 1.2, delayTime: 3.5, depth: 0.8, spread: 180, wet: 0.6 }
    }
  }
};

const samplers = {}; // name → { sampler, loaded, promise }

/**
 * シンセサイザーの楽器を作る
 * def.synth：{ partials, envelope, filter, filterEnvelope, detune, pan, chorus, volume }
 *  - partials：倍音ごとの強さ（第1倍音=1）。この割合の波形を2つ、少しずらして重ねる（detune セント）
 *  - filter / filterEnvelope：ローパスフィルターと、その開き具合の時間変化（音の明るさの変化）
 */
export function createSynth(def) {
  const sy = def.synth;
  const voice = {
    oscillator: { type: "custom", partials: sy.partials },
    envelope: sy.envelope,
    filter: sy.filter,
    filterEnvelope: sy.filterEnvelope
  };
  const out = new Tone.Gain(1);
  let node = out;
  if (sy.chorus) {
    const chorus = new Tone.Chorus(sy.chorus).start();
    out.connect(chorus);
    node = chorus;
  }
  node.toDestination();
  // デチューンした2つの声を重ねて、厚みと左右の広がりを出す
  const layers = [-1, 1].map((sign) => {
    const ps = new Tone.PolySynth(Tone.MonoSynth, { ...voice, detune: sign * (sy.detune || 0) });
    ps.maxPolyphony = 8;
    ps.volume.value = (def.volume ?? 0) - 3;
    if (sy.pan) {
      // 2 つの声を左右に振る（左右の広がり）
      const panner = new Tone.Panner(sign * sy.pan);
      ps.connect(panner);
      panner.connect(out);
    } else {
      ps.connect(out);
    }
    return ps;
  });
  return {
    triggerAttackRelease(notes, dur, time, velocity) {
      layers.forEach((l) => l.triggerAttackRelease(notes, dur, time, velocity));
    }
  };
}

/** 楽器を読み込む（同じ楽器は 1 回だけ）。読み込み済みなら何もしない */
export function loadInstrument(name) {
  const def = INSTRUMENTS[name];
  if (!def) return Promise.resolve(false);
  if (samplers[name]) return samplers[name].promise;
  if (def.synth) {
    // シンセは読み込むファイルが無いので、すぐ使える
    const entry = { sampler: createSynth(def), loaded: true, promise: Promise.resolve(true) };
    samplers[name] = entry;
    console.log(`[AUDIO] ${def.label}（シンセ）を用意しました`);
    return entry.promise;
  }
  const entry = { sampler: null, loaded: false, promise: null };
  entry.promise = new Promise((resolve) => {
    try {
      entry.sampler = new Tone.Sampler({
        urls: urlsOf(def.files),
        baseUrl: `${BASE}${name}/`,
        release: def.release,
        volume: def.volume,
        onload: () => {
          entry.loaded = true;
          console.log(`[AUDIO] ${def.label} の音源を読み込みました`);
          resolve(true);
        },
        onerror: (e) => {
          console.warn(`[AUDIO] ${def.label} の音源を読み込めません（ピアノで代用します）`, e);
          resolve(false);
        }
      }).toDestination();
    } catch (e) {
      console.warn(`[AUDIO] ${def.label} を用意できません`, e);
      resolve(false);
    }
  });
  samplers[name] = entry;
  return entry.promise;
}

/** 楽器が鳴らせる状態か */
export function isInstrumentReady(name) {
  return !!(samplers[name] && samplers[name].loaded);
}

/**
 * 楽器で音を鳴らす。鳴らせたら true（まだ読み込み中なら false を返すので、呼び出し側でピアノに切り替える）
 * @param {string} name 楽器名（INSTRUMENTS のキー）
 * @param {string|string[]} notes 音名（"C4" など）または音名の配列
 * @param {number} durationSec 音の長さ（秒）
 * @param {number} [time] 鳴らす時刻（Tone.now() 基準）。省略すると今すぐ
 * @param {number} [velocity=1] 強さ 0〜1
 */
export function playInstrument(name, notes, durationSec, time, velocity = 1) {
  const entry = samplers[name];
  if (!entry || !entry.loaded) return false;
  try {
    entry.sampler.triggerAttackRelease(notes, durationSec, time, velocity);
    return true;
  } catch (e) {
    console.warn(`[AUDIO] ${name} の発音エラー`, e);
    return false;
  }
}
