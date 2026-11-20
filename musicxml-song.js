/**
 * MusicXML の楽譜から、アプリで弾く右手の音の列を作る（DOM の DOMParser を使用）
 *
 * 楽譜ソフト（MuseScore など）で書き出した .musicxml をそのまま読む。
 *  - 最初のパート・最初の声部（voice 1）の音を、上から順に 1 音ずつ弾く音として取り出す
 *  - 休符は「次の音までの間」として扱う
 *  - タイでつながった音は 1 回の打鍵にまとめ、長さを合計する
 *  - 和音（<chord/>）は一番上の音以外を無視、装飾音（<grace/>）も無視
 *  - 指番号は、楽譜に運指記号（<fingering>）があればそれを使い、無ければ下の規則で決める
 *  - 練習番号（<rehearsal>、例：「Aメロ」）があれば、そこからを 1 つの区間として名前を付ける
 *
 * 長さの単位はアプリと同じ「8 分音符 = 1」。
 */

const STEP_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const STEP_JP = { C: "ド", D: "レ", E: "ミ", F: "ファ", G: "ソ", A: "ラ", B: "シ" };
// 指番号の規則：基準オクターブの ド=1, レ=2, ミ=3, ファ=4, ソ=5（♭・♯が付いても同じ）
const STEP_FINGER = { C: 1, D: 2, E: 3, F: 4, G: 5 };
const FINGER_KEY_BY_NUM = { 1: "THUMB", 2: "INDEX", 3: "MIDDLE", 4: "RING", 5: "PINKY" };

/** MIDI ノート番号（C4 = 60） */
export function midiOf(step, alter, octave) {
  return (octave + 1) * 12 + STEP_SEMITONE[step] + alter;
}

/** 周波数（A4 = 440Hz、平均律） */
export function freqOfMidi(midi) {
  return Math.round(440 * Math.pow(2, (midi - 69) / 12) * 100) / 100;
}

/**
 * 指番号を決める
 * 基準オクターブ（homeOctave）の ド〜ソ を 1〜5 に割り当て、それより低い音はすべて 1、高い音はすべて 5
 */
export function fingerForPitch(step, alter, octave, homeOctave) {
  const midi = midiOf(step, alter, octave);
  const low = midiOf("C", 0, homeOctave);
  const high = midiOf("G", 0, homeOctave);
  if (midi < low) return { finger: 1, octaveShift: -1 };
  if (midi > high) return { finger: 5, octaveShift: 1 };
  return { finger: STEP_FINGER[step] || 1, octaveShift: 0 };
}

function childText(el, name) {
  const c = el.getElementsByTagName(name)[0];
  return c ? c.textContent.trim() : null;
}

function directChild(el, name) {
  for (const c of el.children) if (c.tagName === name) return c;
  return null;
}

/**
 * MusicXML の文字列から、弾く音の列を作る
 * @param {string} xmlText MusicXML（score-partwise）の中身
 * @param {object} [opt]
 * @param {number} [opt.homeOctave=4] 指番号の規則で ド=1 とするオクターブ（4 なら C4〜G4 が 1〜5）
 * @returns {{ title: string, notes: Array<object>, sections: string[], measures: [number, number], bpm: number|null }}
 *   2 つ目以降のパートがあれば伴奏として読み、各音に accomp（[{ note, midi, offset, dur }]、offset はその打鍵からの遅れ）を付ける
 */
export function parseMusicXmlMelody(xmlText, opt = {}) {
  const homeOctave = opt.homeOctave ?? 4;
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error(`MusicXML を読めません: ${err.textContent.slice(0, 200)}`);
  const title = childText(doc, "work-title") || childText(doc, "movement-title") || "";
  const part = doc.getElementsByTagName("part")[0];
  if (!part) throw new Error("MusicXML にパートがありません");

  let divisions = 1;
  let time = 0; // 曲頭からの位置（divisions 単位）
  let firstVoice = null;
  let sectionName = null;
  const sections = [];
  const events = []; // { start, dur, step, alter, octave, fingering, measure, section }
  let pendingTieFrom = null; // タイの続きを待っている音
  let firstMeasure = null;
  let lastMeasure = null;
  let endTime = 0;
  let firstMeasureLen = null;

  for (const measure of part.getElementsByTagName("measure")) {
    const mno = Number(measure.getAttribute("number"));
    if (firstMeasure === null) firstMeasure = mno;
    lastMeasure = mno;
    let pos = time;
    let measureLen = 0;
    for (const el of measure.children) {
      if (el.tagName === "attributes") {
        const d = childText(el, "divisions");
        if (d) divisions = Number(d);
      } else if (el.tagName === "direction") {
        const r = childText(el, "rehearsal");
        if (r) {
          sectionName = r;
          sections.push(r);
        }
      } else if (el.tagName === "backup") {
        pos -= Number(childText(el, "duration") || 0);
      } else if (el.tagName === "forward") {
        pos += Number(childText(el, "duration") || 0);
      } else if (el.tagName === "note") {
        if (directChild(el, "grace")) continue;
        const voice = childText(el, "voice") || "1";
        if (firstVoice === null) firstVoice = voice;
        const dur = Number(childText(el, "duration") || 0);
        const isChord = !!directChild(el, "chord");
        if (voice !== firstVoice) {
          if (!isChord) pos += dur;
          continue;
        }
        if (isChord) continue; // 和音の 2 音目以降は無視（1 音目＝一番上として扱う）
        const start = pos;
        pos += dur;
        measureLen = Math.max(measureLen, pos - time);
        if (directChild(el, "rest")) {
          pendingTieFrom = null;
          continue;
        }
        const pitch = directChild(el, "pitch");
        const step = childText(pitch, "step");
        const alter = Number(childText(pitch, "alter") || 0);
        const octave = Number(childText(pitch, "octave"));
        const ties = [...el.getElementsByTagName("tie")].map((t) => t.getAttribute("type"));
        const fingeringText = childText(el, "fingering");

        const prev = pendingTieFrom;
        if (ties.includes("stop") && prev && prev.step === step && prev.alter === alter && prev.octave === octave) {
          // タイの続き：前の音を伸ばすだけで、新しい打鍵にはしない
          prev.dur += dur;
          pendingTieFrom = ties.includes("start") ? prev : null;
          continue;
        }
        const ev = {
          start, dur, step, alter, octave, measure: mno, section: sectionName,
          fingering: fingeringText ? Number(fingeringText) : null
        };
        events.push(ev);
        pendingTieFrom = ties.includes("start") ? ev : null;
      }
    }
    // 小節の長さ：拍子どおりでなくても、実際に並んでいる音・休符の長さで進める
    if (firstMeasureLen === null) firstMeasureLen = measureLen;
    time += measureLen;
    endTime = time;
  }

  const perEighth = divisions / 2;
  const notes = events.map((ev, i) => {
    const next = events[i + 1];
    const ioiDiv = (next ? next.start : endTime) - ev.start;
    const midi = midiOf(ev.step, ev.alter, ev.octave);
    const rule = fingerForPitch(ev.step, ev.alter, ev.octave, homeOctave);
    const fingerNum = ev.fingering >= 1 && ev.fingering <= 5 ? ev.fingering : rule.finger;
    const accidental = ev.alter < 0 ? "♭" : ev.alter > 0 ? "♯" : "";
    const nameAlter = ev.alter < 0 ? "b" : ev.alter > 0 ? "#" : "";
    return {
      step: i + 1,
      phrase: Math.max(1, sections.indexOf(ev.section) + 1),
      section: ev.section,
      measure: ev.measure,
      fingerNum,
      fingerKey: FINGER_KEY_BY_NUM[fingerNum],
      note: STEP_JP[ev.step] + accidental,
      rightNote: `${ev.step}${nameAlter}${ev.octave}`,
      freq: freqOfMidi(midi),
      octaveShift: rule.octaveShift,
      autoLeftNote: null,
      onset: ev.start / perEighth,
      ioi: ioiDiv / perEighth,
      dur: ev.dur / perEighth
    };
  });
  // 2 つ目以降のパートは伴奏として読み、各打鍵に「その打鍵から次の打鍵までに鳴る伴奏の音」を付ける
  const parts = [...doc.getElementsByTagName("part")];
  const accEvents = parts.slice(1).flatMap((p) => readAccompanimentPart(p));
  if (accEvents.length) {
    // accEvents の時刻は 8 分音符単位。notes[i].onset も同じ単位
    accEvents.sort((a, b) => a.start - b.start);
    let j = 0;
    notes.forEach((n, i) => {
      const next = notes[i + 1];
      const from = i === 0 ? -Infinity : n.onset; // 曲頭の打鍵より前の伴奏は最初の打鍵で鳴らす
      const to = next ? next.onset : Infinity;
      const list = [];
      while (j < accEvents.length && accEvents[j].start < to) {
        const e = accEvents[j++];
        if (e.start < from) continue;
        list.push({ note: e.note, midi: e.midi, offset: Math.max(0, e.start - n.onset), dur: e.dur });
      }
      n.accomp = list;
    });
  }

  // 拍子と弱起：ノーツの小節線を楽譜どおりに引くため（8 分音符 = 1）
  const timeEl = part.getElementsByTagName("time")[0];
  const beats = timeEl ? Number(childText(timeEl, "beats")) : 4;
  const beatType = timeEl ? Number(childText(timeEl, "beat-type")) : 4;
  const firstMeasureEl = part.getElementsByTagName("measure")[0];
  let pickupLen = 0;
  if (firstMeasureEl && firstMeasureEl.getAttribute("implicit") === "yes") {
    pickupLen = firstMeasureLen / perEighth;
  }
  const meter = { barEighths: (beats * 8) / beatType, beatEighths: 8 / beatType, firstBarStart: pickupLen };

  const tempoEl = [...doc.getElementsByTagName("sound")].find((el) => el.getAttribute("tempo"));
  const bpm = tempoEl ? Number(tempoEl.getAttribute("tempo")) : null;

  return { title, notes, sections, measures: [firstMeasure, lastMeasure], bpm, meter };
}

/**
 * 伴奏パートの音をすべて取り出す（和音・複数の声部もそのまま。タイは 1 つの音にまとめる）
 * @returns {Array<{start:number, dur:number, note:string, midi:number}>} 時刻と長さは 8 分音符 = 1
 */
function readAccompanimentPart(part) {
  let divisions = 1;
  let time = 0;
  const events = [];
  const openTies = new Map(); // midi → まだタイが続いている音
  for (const measure of part.getElementsByTagName("measure")) {
    let pos = time;
    let measureLen = 0;
    let lastStart = pos;
    for (const el of measure.children) {
      if (el.tagName === "attributes") {
        const d = childText(el, "divisions");
        if (d) divisions = Number(d);
      } else if (el.tagName === "backup") {
        pos -= Number(childText(el, "duration") || 0);
      } else if (el.tagName === "forward") {
        pos += Number(childText(el, "duration") || 0);
        measureLen = Math.max(measureLen, pos - time);
      } else if (el.tagName === "note") {
        if (directChild(el, "grace")) continue;
        const dur = Number(childText(el, "duration") || 0);
        const isChord = !!directChild(el, "chord");
        const start = isChord ? lastStart : pos;
        if (!isChord) {
          lastStart = pos;
          pos += dur;
        }
        measureLen = Math.max(measureLen, pos - time);
        if (directChild(el, "rest")) continue;
        const pitch = directChild(el, "pitch");
        const step = childText(pitch, "step");
        const alter = Number(childText(pitch, "alter") || 0);
        const octave = Number(childText(pitch, "octave"));
        const midi = midiOf(step, alter, octave);
        const ties = [...el.getElementsByTagName("tie")].map((t) => t.getAttribute("type"));
        const prev = openTies.get(midi);
        if (ties.includes("stop") && prev) {
          prev.dur += dur;
          if (!ties.includes("start")) openTies.delete(midi);
          continue;
        }
        const nameAlter = alter < 0 ? "b" : alter > 0 ? "#" : "";
        const ev = { start: start, dur, note: `${step}${nameAlter}${octave}`, midi };
        events.push(ev);
        if (ties.includes("start")) openTies.set(midi, ev);
      }
    }
    time += measureLen;
  }
  const perEighth = divisions / 2;
  return events.map((e) => ({ ...e, start: e.start / perEighth, dur: e.dur / perEighth }));
}
