#!/usr/bin/env python3
"""
新宝島の楽譜ファイル（songs/shin_takarajima.musicxml）を作る

元にしているのは、利用者が書き起こした右手のメロディ（音名・リズム・指使い）。
前奏〜後奏の全 160 小節・628 打鍵（書き起こしの 164 小節から Aメロの 35〜38 小節を削除）。調号は ♭2 つ、前奏 ♩=149、Aメロ以降 ♩=156。
右手の基本の位置は C5〜G5（ド〜ソ）なので、アプリでは homeOctave: 5 で読み込む。

書式は "音名:指番号:次の音までの長さ:音の長さ"（長さは 8 分音符 = 1。音の長さを省くと
「次の音までの長さ」と同じ。差があるところは休符になる）。
タイでつながる音は 1 打鍵として書いてあり、小節線をまたぐところは楽譜ではタイで分ける。

使い方：python3 tools/make_shin_takarajima.py   （songs/shin_takarajima.musicxml を上書き）
MuseScore で開いて直すこともできる（その場合はこのスクリプトを実行し直さないこと）。
"""
from pathlib import Path
from xml.sax.saxutils import escape

MOTIFS = {
    # ソ レ ド レ ／ ファ レ ド レ レ（♩ ♩ ♩ ♪♪ ｜ 𝄾♪ 𝄾♪ 𝄾♪ 𝄾♪）
    "F":  "G4:1:2 D5:2:2 C5:1:2 D5:2:1 F5:4:2:1 D5:2:2:1 C5:1:2:1 D5:2:2:1 D5:2:1",
    # ソ レ ド レ ／ ソ(高) レ ド レ レ
    "S":  "G4:1:2 D5:2:2 C5:1:2 D5:2:1 G5:5:2:1 D5:2:2:1 C5:1:2:1 D5:2:2:1 D5:2:1",
    # ソ レ ド レ ／ ソ(低) レ ド レ レ（間奏）
    "L":  "G4:1:2 D5:2:2 C5:1:2 D5:2:1 G4:1:2:1 D5:2:2:1 C5:1:2:1 D5:2:2:1 D5:2:1",
    # ソ レ ド レ ／ ソ レ ド ファ ファ
    "SF": "G4:1:2 D5:2:2 C5:1:2 D5:2:1 G5:5:2:1 D5:2:2:1 C5:1:2:1 F5:4:2:1 F5:4:1",
    # ソ ソ ド ド ／ ファ ソ シ♭ ド レ ファ ソ
    "R":  "G4:1:2 G4:1:2 C5:2:2 C5:2:1 F4:1:2:1 G4:2:1 Bb4:3:1 C5:1:1 D5:2:1 F5:4:1 G5:5:2",
    # 大サビ最後：ソ レ ド レ ／ ソ レ ド レ レ ファ ファ
    "E":  "G4:1:2 D5:2:2 C5:1:2 D5:2:1 G5:5:2:1 D5:2:2:1 C5:1:1 D5:2:1 D5:2:1 F5:4:1 F5:4:1",
    # 前奏・後奏の共通フレーズ：ソ ／ ファ レ ド ／ シ♭ ソ ／ ファ ／ ソ シ♭ ／ ド
    "P":  "G5:5:8 F5:4:4 D5:2:2 C5:1:4 Bb4:2:2 G4:1:10 F4:1:2 G4:1:4 Bb4:1:4 C5:2:4",
}

SECTIONS = [
    ("前奏",   ["P", "Bb4:1:2 C5:2:4 D5:3:2 Bb4:1:4", "F5:4:2 D5:2:2 F5:4:2 D5:2:2 G5:5:16 F5:4:16"]),
    # Aメロ：もとの 35〜38 小節（S・F の 2 つのまとまり）は利用者の指示で削除（2026-11-20）
    ("Aメロ",  ["F", "S", "F", "SF", "F", "S", "S", "S", "S", "F", "S", "R"]),
    ("サビ",   ["F", "S", "F", "SF", "F", "S", "F", "SF", "F", "S", "F", "SF"]),
    ("間奏",   ["L", "L", "L", "F", "L", "L", "F", "R"]),
    ("サビ2",  ["F", "S", "F", "SF", "F", "S", "F", "SF", "F", "F", "F", "F", "F", "S", "F", "R"]),
    ("大サビ", ["F", "S", "F", "SF", "F", "S", "F", "SF", "F", "S", "F", "E"]),
    ("後奏",   [
        "P", "Bb4:1:2 C5:2:4 D5:3:2 F5:4:2 G5:5:2",
        "F5:4:4 D5:2:2 C5:1:4 Bb4:2:2 G4:1:10 F4:1:2 G4:1:4 Bb4:1:4 C5:2:4 A4:1:2 Bb4:2:2",
        "P", "Bb4:1:2 C5:2:4 D5:3:6",
        "F5:4:2 D5:2:2 F5:4:2 D5:2:2",
        "P", "A4:1:2 Bb4:2:2",
        "F5:4:2 D5:2:2 F5:4:2 D5:2:2 G5:5:8",
    ]),
]
TEMPOS = {"前奏": 149, "Aメロ": 156}
BAR = 8          # 4/4 拍子の 1 小節 = 8 分音符 8 つ
DIVISIONS = 2    # MusicXML の divisions（4 分音符 = 2 → 8 分音符 = 1）
TYPES = {8: ("whole", 0), 6: ("half", 1), 4: ("half", 0), 3: ("quarter", 1), 2: ("quarter", 0), 1: ("eighth", 0)}


def build_events():
    """打鍵の列 [(onset, dur, step, alter, octave, finger, section)] と曲の長さ"""
    events, t = [], 0
    for name, parts in SECTIONS:
        for part in parts:
            for tok in MOTIFS.get(part, part).split():
                f = tok.split(":")
                note, finger, ioi = f[0], int(f[1]), int(f[2])
                dur = int(f[3]) if len(f) > 3 else ioi
                step, octave = note[0], int(note[-1])
                alter = -1 if "b" in note[1:-1] else 0
                events.append((t, dur, step, alter, octave, finger, name))
                t += ioi
    return events, t


def split_len(n):
    """長さを楽譜で書ける音価（全・付点2分・2分・付点4分・4分・8分）に分ける"""
    out = []
    for v in (8, 6, 4, 3, 2, 1):
        while n >= v:
            out.append(v)
            n -= v
    return out


def segments(events, total):
    """小節ごとの [(kind, length, event, tie_start, tie_stop, first)]（kind は note / rest）"""
    # 音と休符を時間順に並べる
    items, t = [], 0
    for ev in events:
        onset, dur = ev[0], ev[1]
        if onset > t:
            items.append(("rest", t, onset - t, None))
        items.append(("note", onset, dur, ev))
        t = onset + dur
    if total > t:
        items.append(("rest", t, total - t, None))
    measures = [[] for _ in range(total // BAR)]
    for kind, start, length, ev in items:
        pieces, pos, end = [], start, start + length
        while pos < end:
            bar_end = (pos // BAR + 1) * BAR
            seg_end = min(end, bar_end)
            for v in split_len(seg_end - pos):
                pieces.append((pos, v))
                pos += v
        for i, (p, v) in enumerate(pieces):
            measures[p // BAR].append((kind, v, ev, kind == "note" and i < len(pieces) - 1, kind == "note" and i > 0, i == 0))
    return measures


def note_xml(kind, length, ev, tie_start, tie_stop, first):
    typ, dots = TYPES[length]
    x = ["      <note>"]
    if kind == "rest":
        x.append("        <rest/>")
    else:
        _, _, step, alter, octave, finger, _ = ev
        x.append("        <pitch>")
        x.append(f"          <step>{step}</step>")
        if alter:
            x.append(f"          <alter>{alter}</alter>")
        x.append(f"          <octave>{octave}</octave>")
        x.append("        </pitch>")
    x.append(f"        <duration>{length}</duration>")
    if tie_stop:
        x.append('        <tie type="stop"/>')
    if tie_start:
        x.append('        <tie type="start"/>')
    x.append("        <voice>1</voice>")
    x.append(f"        <type>{typ}</type>")
    x.extend(["        <dot/>"] * dots)
    if kind == "note" and ev[3] < 0:
        pass  # 調号（♭2 つ）で臨時記号は不要
    notations = []
    if tie_stop:
        notations.append('          <tied type="stop"/>')
    if tie_start:
        notations.append('          <tied type="start"/>')
    if kind == "note" and first:
        notations.append(f"          <technical><fingering>{ev[5]}</fingering></technical>")
    if notations:
        x.append("        <notations>")
        x.extend(notations)
        x.append("        </notations>")
    x.append("      </note>")
    return "\n".join(x)


def main():
    events, total = build_events()
    assert total % BAR == 0, total
    measures = segments(events, total)
    section_start_bar = {}
    t = 0
    for ev in events:
        section_start_bar.setdefault(ev[6], ev[0] // BAR)
    out = [
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
        '<score-partwise version="4.0">',
        "  <work><work-title>新宝島</work-title></work>",
        "  <identification><miscellaneous><miscellaneous-field name=\"source\">"
        + escape("利用者の書き起こし（右手メロディ・前奏〜後奏 160 小節・628 打鍵。Aメロのもとの 35〜38 小節は削除）。指番号は利用者の指定＋推定。"
                 "右手の基本の位置は C5〜G5（アプリは homeOctave: 5 で読む）。tools/make_shin_takarajima.py で作成")
        + "</miscellaneous-field></miscellaneous></identification>",
        "  <part-list>",
        '    <score-part id="P1"><part-name>右手</part-name></score-part>',
        "  </part-list>",
        '  <part id="P1">',
    ]
    for i, segs in enumerate(measures):
        out.append(f'    <measure number="{i + 1}">')
        if i == 0:
            out.append("      <attributes>")
            out.append(f"        <divisions>{DIVISIONS}</divisions>")
            out.append("        <key><fifths>-2</fifths></key>")
            out.append("        <time><beats>4</beats><beat-type>4</beat-type></time>")
            out.append("        <clef><sign>G</sign><line>2</line></clef>")
            out.append("      </attributes>")
        for name, bar in section_start_bar.items():
            if bar == i:
                out.append('      <direction placement="above">')
                out.append(f"        <direction-type><rehearsal>{escape(name)}</rehearsal></direction-type>")
                if name in TEMPOS:
                    out.append(f'        <sound tempo="{TEMPOS[name]}"/>')
                out.append("      </direction>")
        out.extend(note_xml(*s) for s in segs)
        out.append("    </measure>")
    out += ["  </part>", "</score-partwise>", ""]
    path = Path(__file__).resolve().parent.parent / "songs" / "shin_takarajima.musicxml"
    path.write_text("\n".join(out), encoding="utf-8")
    print(f"{path}: {len(events)} 打鍵・{len(measures)} 小節")


if __name__ == "__main__":
    main()
