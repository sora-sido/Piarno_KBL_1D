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
 *  - music_box / harpsichord / electric_piano_1 / electric_piano_2：FluidR3_GM（Frank Wen）を midi-js-soundfonts（Benjamin Gleitzman）で mp3 にしたもの（CC BY 3.0）
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

// 新宝島の音につける響き（リバーブ）：1.8 秒で消える響きを 3 割ほど混ぜる
const SHIN_REVERB = { decay: 1.8, preDelay: 0.01, wet: 0.3 };

/** 楽器の定義：サンプル、余韻（release）、音量（dB）、響き（reverb）。folder を省くと楽器名のフォルダ */
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
  // 新宝島で選べる電子ピアノ（鳴らした瞬間が強く、自然に消えていく録音）。どちらも響き（リバーブ）付き
  //  FluidR3_GM の Electric Piano 1（ローズ風・やわらかい）と Electric Piano 2（FM 風・きらきら）
  //  録音の音量が小さいので、音量を上げてある
  shin_ep1: {
    label: "電子ピアノ（やわらかい）",
    folder: "electric_piano_1",
    files: FLUID_SET,
    release: 1, volume: 6,
    reverb: SHIN_REVERB
  },
  shin_ep2: {
    label: "電子ピアノ（きらきら）",
    folder: "electric_piano_2",
    files: FLUID_SET,
    release: 1, volume: 8,
    reverb: SHIN_REVERB
  },
  // 新宝島の鍵盤（シンセ）の音色
  // 1 回目（2026-11-20）：原曲を Demucs で分けた「other」の Aメロのリフに倍音を合わせた → 利用者から「キンキンして耳が痛い」
  //   原因：音のエネルギーの約 7 割が 800〜1600Hz（耳がいちばん敏感な帯域）の第2倍音に集中していた。低い音がほとんど無かった
  // 2 回目（2026-11-20）：利用者が DAW で取り出した鍵盤パート（other_mixed）の Aメロ（32〜60 秒）の帯域ごとの音量に合わせて作り直した
  //   - 1 オクターブ下の声（sub）を足して、200〜400Hz の太さを出す（利用者の音源には 1 オクターブ下の音が同じくらいの強さで入っている）
  //   - 上の声は第2倍音を中心に、第3倍音から上をなだらかに弱める（急な山を作らない）。3kHz から上はフィルターで抑える
  //   - 音量は 1 回目より約 4dB 小さい。立ち上がりも少しだけ柔らかく（4ms → 8ms）、コーラスは控えめ
  //   帯域ごとの音量（全体に対する dB：100-200/200-400/400-800/800-1.6k/1.6k-3.2k/3.2k-6.4kHz）
  //     利用者の音源 −14 / −6 / −12 / −6 / −5 / −9　→　このシンセ −17 / −7 / −8 / −4 / −7 / −13（1 回目は −37 / −17 / −7 / −2 / −10 / −23）
  //   録音そのものは使っていない（音色を測っただけ）
  //  3 回目（2026-11-20）：「べたーっとした音」との声で、鳴らした瞬間が強く消えていく形にし、響き（リバーブ）を足した
  shin_keys: {
    label: "新宝島の鍵盤",
    volume: -12,
    reverb: SHIN_REVERB,
    synth: {
      partials: [0.3, 1, 0.6, 0.5, 0.35, 0.25, 0.18, 0.13, 0.09, 0.06, 0.045, 0.03],
      // 鳴らした瞬間がいちばん強く、約 3 秒かけて消えていく（ピアノのような形。伸ばしている間ずっと同じ音量だと「べたー」と聞こえる）
      // Tone.js の exponential（指数）だと最初の 1 秒で消えすぎたので linear（直線）にした
      envelope: { attack: 0.003, decay: 3, sustain: 0, release: 1.2, decayCurve: "linear" },
      filter: { type: "lowpass", Q: 1, rolloff: -12 },
      // 鳴らした瞬間は明るく（約 4kHz まで）、0.6 秒ほどで落ち着いた明るさ（約 1.5kHz）になる
      filterEnvelope: { attack: 0.002, decay: 0.6, sustain: 0.35, release: 1, baseFrequency: 900, octaves: 2.2 },
      detune: 5,
      pan: 0.6,
      chorus: { frequency: 0.8, delayTime: 4, depth: 0.5, spread: 180, wet: 0.35 },
      // 1 オクターブ下の声：倍音が 1/k^0.9 でなだらかに減る波形（のこぎり波より少し柔らかい）
      sub: {
        gain: -2,
        voice: { oscillator: { type: "custom", partials: [1, 0.536, 0.372, 0.287, 0.235, 0.199, 0.174, 0.154, 0.138, 0.126, 0.116, 0.107, 0.099, 0.093, 0.087, 0.082, 0.078, 0.074, 0.071, 0.067] } }
      }
    }
  }
};

const samplers = {}; // name → { sampler, loaded, promise }

/**
 * 楽器の音の出口。def.reverb があれば響き（リバーブ）を通してからスピーカーへ
 * def.reverb：{ decay（響きが消えるまでの秒）, preDelay, wet（響きの割合 0〜1） }
 * 返り値：{ input（楽器をつなぐ先）, ready（響きの準備ができたら解決） }
 */
function makeOutput(def, input) {
  if (!def.reverb) {
    input.toDestination();
    return Promise.resolve();
  }
  const reverb = new Tone.Reverb(def.reverb).toDestination();
  input.connect(reverb);
  return reverb.ready;
}

/**
 * シンセサイザーの楽器を作る
 * def.synth：{ partials, envelope, filter, filterEnvelope, detune, pan, chorus, sub }
 *  - phaser：Tone.Phaser の設定（frequency・octaves・baseFrequency・wet など）。うねりを付ける
 *  - sub：{ gain, voice }　1 オクターブ下の声（gain は上の声との音量差 dB、voice で波形などを上書き）
 *  - partials：倍音ごとの強さ（第1倍音=1）。この割合の波形を2つ、少しずらして重ねる（detune セント）
 *  - filter / filterEnvelope：ローパスフィルターと、その開き具合の時間変化（音の明るさの変化）
 */
export function createSynth(def) {
  const fx = makeSynthEffects(def);
  const voices = createSynthVoices(def, fx.input);
  return { ready: fx.ready, triggerAttackRelease: voices.triggerAttackRelease };
}

/** シンセの後ろにかける効果（コーラス・フェイザー・響き）。input につないだ音が効果を通ってスピーカーへ */
function makeSynthEffects(def) {
  const sy = def.synth;
  const input = new Tone.Gain(1);
  let node = input;
  if (sy.chorus) {
    const chorus = new Tone.Chorus(sy.chorus).start();
    node.connect(chorus);
    node = chorus;
  }
  if (sy.phaser) {
    // フェイザー：倍音の一部をゆっくり打ち消したり戻したりして「うわん、うわん」とうねらせる
    const phaser = new Tone.Phaser(sy.phaser);
    node.connect(phaser);
    node = phaser;
  }
  return { input, ready: makeOutput(def, node) };
}

/**
 * シンセの声（効果をかける前の音）を作り、dest につなぐ
 * context を渡すと、その音の場（書き出し用の OfflineContext など）で作る。省くといつもの音の場
 */
function createSynthVoices(def, dest, context) {
  const sy = def.synth;
  const ctxOpt = context ? { context } : {};
  const voice = {
    oscillator: { type: "custom", partials: sy.partials },
    envelope: sy.envelope,
    filter: sy.filter,
    filterEnvelope: sy.filterEnvelope
  };
  // デチューンした2つの声を重ねて、厚みと左右の広がりを出す
  const layers = [-1, 1].map((sign) => {
    // PolySynth の音の場（context）は、声の設定（options）ではなく PolySynth 自身に渡す
    const ps = new Tone.PolySynth({ ...ctxOpt, voice: Tone.MonoSynth, options: { ...voice, detune: sign * (sy.detune || 0) } });
    ps.maxPolyphony = 8;
    ps.volume.value = (def.volume ?? 0) - 3;
    if (sy.pan) {
      // 2 つの声を左右に振る（左右の広がり）
      const panner = new Tone.Panner({ ...ctxOpt, pan: sign * sy.pan });
      ps.connect(panner);
      panner.connect(dest);
    } else {
      ps.connect(dest);
    }
    return ps;
  });
  // 1 オクターブ下の声（sub）：低い音を足して、細くて鋭い音を太く柔らかくする
  let sub = null;
  if (sy.sub) {
    sub = new Tone.PolySynth({ ...ctxOpt, voice: Tone.MonoSynth, options: { ...voice, ...(sy.sub.voice || {}) } });
    sub.maxPolyphony = 8;
    sub.volume.value = (def.volume ?? 0) - 3 + (sy.sub.gain ?? -6);
    sub.connect(dest);
  }
  const down = (n) => Tone.Frequency(n).transpose(-12).toNote();
  return {
    triggerAttackRelease(notes, dur, time, velocity) {
      layers.forEach((l) => l.triggerAttackRelease(notes, dur, time, velocity));
      if (sub) sub.triggerAttackRelease(Array.isArray(notes) ? notes.map(down) : down(notes), dur, time, velocity);
    }
  };
}

// 前もって録音しておく高さ（3 半音ごと。間の高さは Tone.Sampler が近い音を少しずらして鳴らす）
const PRERENDER_NOTES = ["A3", "C4", "Eb4", "Gb4", "A4", "C5", "Eb5", "Gb5", "A5", "C6"];

/**
 * シンセの音を前もって 1 音ずつ書き出し（オフラインで録音し）、演奏中は録音を鳴らす楽器を作る
 * シンセを打鍵のたびに鳴らすと、1 音に 3 つの声（左右の 2 つと 1 オクターブ下）を作り、それぞれ約 4 秒鳴り続けるため、
 * 速いリフでは同時に 20 以上の声が要り、1 打鍵の処理が 100ms 近くかかって画面が止まった（2026-11-21 の計測）。
 * 録音を鳴らす方式なら、電子ピアノと同じ軽さで、同じ音色になる
 */
export async function createPrerenderedSynth(def) {
  const sy = def.synth;
  const env = sy.envelope || {};
  const hold = Math.min(4, (env.attack || 0) + (env.decay || 1) + 0.05); // 鳴り終わるまで
  const urls = {};
  for (const note of PRERENDER_NOTES) {
    // Tone.Offline は書き出しの間 Tone.js 全体の音の場を切り替えてしまい、その間に打鍵するとエラーになる。
    // そのため、書き出し専用の音の場を作って、そこにだけ声を作る
    const off = new Tone.OfflineContext(2, hold + 0.05, Tone.getContext().sampleRate);
    const v = createSynthVoices(def, off.destination, off);
    v.triggerAttackRelease(note, hold, 0, 1);
    urls[note] = await off.render();
    off.dispose();
  }
  const fx = makeSynthEffects(def);
  const sampler = new Tone.Sampler({ urls, release: env.release ?? 0.5, attack: 0 });
  sampler.connect(fx.input);
  await Promise.all([fx.ready, Tone.loaded()]);
  return sampler;
}

/** 楽器を読み込む（同じ楽器は 1 回だけ）。読み込み済みなら何もしない */
export function loadInstrument(name) {
  const def = INSTRUMENTS[name];
  if (!def) return Promise.resolve(false);
  if (samplers[name]) return samplers[name].promise;
  if (def.synth) {
    // シンセは読み込むファイルが無いので、すぐ使える
    const entry = { sampler: null, loaded: false, promise: null };
    // 音の書き出しと響き（リバーブ）の準備が終わるまで（1 秒ほど）は、ピアノで代わりに鳴らす
    entry.promise = createPrerenderedSynth(def).then((sampler) => {
      entry.sampler = sampler;
      entry.loaded = true;
      console.log(`[AUDIO] ${def.label}（シンセ）を用意しました（${PRERENDER_NOTES.length} 音を書き出し）`);
      return true;
    }).catch((e) => {
      console.warn(`[AUDIO] ${def.label} を用意できません（ピアノで代用します）`, e);
      return false;
    });
    samplers[name] = entry;
    return entry.promise;
  }
  const entry = { sampler: null, loaded: false, promise: null };
  entry.promise = new Promise((resolve) => {
    try {
      let reverbReady = Promise.resolve();
      entry.sampler = new Tone.Sampler({
        urls: urlsOf(def.files),
        baseUrl: `${BASE}${def.folder || name}/`,
        release: def.release,
        volume: def.volume,
        onload: () => {
          reverbReady.then(() => {
            entry.loaded = true;
            console.log(`[AUDIO] ${def.label} の音源を読み込みました`);
            resolve(true);
          });
        },
        onerror: (e) => {
          console.warn(`[AUDIO] ${def.label} の音源を読み込めません（ピアノで代用します）`, e);
          resolve(false);
        }
      });
      reverbReady = makeOutput(def, entry.sampler);
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
