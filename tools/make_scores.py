#!/usr/bin/env python3
"""
新曲 5 曲の楽譜（MusicXML）を書き出すスクリプト

  python3 tools/make_scores.py   → songs/*.musicxml を作り直す

書き出した MusicXML は MuseScore などで開いてそのまま直せる。直したあとは
このスクリプトを使わず、MuseScore から書き出し直したファイルを songs/ に置けばよい。

書き方（1 小節ずつ「|」で区切る。長さは 16 分音符 = 1）
  メロディ（右手）  音名:長さ@指番号    例) E4:2@3   C#5:4@2   r:2（休符）
                    長さのあとに ~ を付けるとタイ（次の同じ音とつながり、1 回の打鍵になる）
  伴奏              音名+音名:長さ      例) C3:2   E3+G3+C4:2   r:4
                    同時に鳴る音のうち一番低い音がベース、残りが和音として鳴る
最初の小節は弱起（アウフタクト）として短くてもよい。
"""
import os
import re
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TYPES = {1: ("16th", 0), 2: ("eighth", 0), 3: ("eighth", 1), 4: ("quarter", 0), 6: ("quarter", 1),
         8: ("half", 0), 12: ("half", 1), 16: ("whole", 0)}
NOTE_RE = re.compile(r"^([A-G])([#b]?)(-?\d)$")


def parse_pitch(s):
    m = NOTE_RE.match(s)
    if not m:
        raise ValueError(f"音名が読めません: {s}")
    step, acc, octv = m.groups()
    return step, {"#": 1, "b": -1, "": 0}[acc], int(octv)


def note_xml(pitches, dur, voice, staff=None, finger=None, tie=None, chord_first=True):
    """pitches=[] は休符。tie は None / 'start' / 'stop' / 'both'"""
    t, dots = TYPES[dur]
    out = []
    if not pitches:
        out.append(f"      <note><rest/><duration>{dur}</duration><voice>{voice}</voice><type>{t}</type>"
                   + "<dot/>" * dots + (f"<staff>{staff}</staff>" if staff else "") + "</note>")
        return out
    for i, p in enumerate(pitches):
        step, alter, octv = parse_pitch(p)
        x = ["      <note>"]
        if i > 0:
            x.append("<chord/>")
        x.append(f"<pitch><step>{step}</step>" + (f"<alter>{alter}</alter>" if alter else "") + f"<octave>{octv}</octave></pitch>")
        x.append(f"<duration>{dur}</duration>")
        if tie in ("stop", "both"):
            x.append('<tie type="stop"/>')
        if tie in ("start", "both"):
            x.append('<tie type="start"/>')
        x.append(f"<voice>{voice}</voice><type>{t}</type>" + "<dot/>" * dots)
        if alter:
            x.append(f"<accidental>{'sharp' if alter > 0 else 'flat'}</accidental>")
        if staff:
            x.append(f"<staff>{staff}</staff>")
        nots = []
        if tie in ("stop", "both"):
            nots.append('<tied type="stop"/>')
        if tie in ("start", "both"):
            nots.append('<tied type="start"/>')
        if finger and i == 0:
            nots.append(f"<technical><fingering>{finger}</fingering></technical>")
        if nots:
            x.append("<notations>" + "".join(nots) + "</notations>")
        x.append("</note>")
        out.append("".join(x))
    return out


def parse_melody_measure(text):
    items = []
    for tok in text.split():
        m = re.match(r"^([^:]+):(\d+)(~?)(?:@(\d))?$", tok)
        if not m:
            raise ValueError(f"メロディの書き方が違います: {tok}")
        p, d, tie, f = m.groups()
        items.append({"pitches": [] if p == "r" else [p], "dur": int(d), "tie": bool(tie), "finger": f})
    return items


def parse_accomp_measure(text):
    items = []
    for tok in text.split():
        m = re.match(r"^([^:]+):(\d+)$", tok)
        if not m:
            raise ValueError(f"伴奏の書き方が違います: {tok}")
        p, d = m.groups()
        items.append({"pitches": [] if p == "r" else p.split("+"), "dur": int(d)})
    return items


def build(song):
    beats, beat_type = song["time"]
    bar_len = beats * 16 // beat_type
    mel = [parse_melody_measure(m) for m in song["melody"].split("|")]
    acc = [parse_accomp_measure(m) for m in song["accomp"].split("|")]
    if len(mel) != len(acc):
        raise ValueError(f"{song['id']}: メロディ {len(mel)} 小節、伴奏 {len(acc)} 小節で数が合いません")
    first_no = 0 if song.get("pickup") else 1
    for i, (m, a) in enumerate(zip(mel, acc)):
        lm, la = sum(x["dur"] for x in m), sum(x["dur"] for x in a)
        no = i + first_no
        if lm != la:
            raise ValueError(f"{song['id']} 小節 {no}: メロディ {lm} と伴奏 {la} の長さが違います")
        if not (song.get("pickup") and i == 0) and lm != bar_len:
            raise ValueError(f"{song['id']} 小節 {no}: 長さ {lm}（{bar_len} のはず）")

    # タイ：~ の付いた音と、次の同じ音を start/stop でつなぐ
    flat = [n for m in mel for n in m]
    for i, n in enumerate(flat):
        n.setdefault("tie_state", None)
    for i, n in enumerate(flat):
        if n["tie"]:
            nxt = flat[i + 1]
            if nxt["pitches"] != n["pitches"]:
                raise ValueError(f"{song['id']}: タイの次が同じ音ではありません {n['pitches']}")
            n["tie_state"] = "both" if n["tie_state"] == "stop" else "start"
            nxt["tie_state"] = "stop"

    def attributes(clef_sign, clef_line):
        return ("      <attributes><divisions>4</divisions>"
                f"<key><fifths>{song['fifths']}</fifths></key>"
                f"<time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time>"
                f"<clef><sign>{clef_sign}</sign><line>{clef_line}</line></clef></attributes>")

    lines = ['<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
             '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
             '<score-partwise version="4.0">',
             f"  <work><work-title>{escape(song['title'])}</work-title></work>",
             f"  <identification><creator type=\"composer\">{escape(song['composer'])}</creator>"
             f"<miscellaneous><miscellaneous-field name=\"source\">{escape(song['note'])}</miscellaneous-field></miscellaneous></identification>",
             "  <part-list>",
             f"    <score-part id=\"P1\"><part-name>{escape(song['melody_name'])}</part-name></score-part>",
             f"    <score-part id=\"P2\"><part-name>{escape(song['accomp_name'])}</part-name></score-part>",
             "  </part-list>"]

    for pid, measures, is_mel in (("P1", mel, True), ("P2", acc, False)):
        lines.append(f'  <part id="{pid}">')
        for i, m in enumerate(measures):
            no = i + first_no
            implicit = ' implicit="yes"' if (song.get("pickup") and i == 0) else ""
            lines.append(f'    <measure number="{no}"{implicit}>')
            if i == 0:
                lines.append(attributes("G", 2) if is_mel else attributes("F", 4))
                if is_mel:
                    lines.append('      <direction placement="above"><direction-type><metronome><beat-unit>'
                                 f"{song['tempo_unit']}</beat-unit><per-minute>{song['tempo']}</per-minute></metronome>"
                                 f"</direction-type><sound tempo=\"{song['bpm_quarter']}\"/></direction>")
            for n in m:
                if is_mel:
                    lines += note_xml(n["pitches"], n["dur"], 1, finger=n["finger"], tie=n.get("tie_state"))
                else:
                    lines += note_xml(n["pitches"], n["dur"], 1)
            lines.append("    </measure>")
        lines.append("  </part>")
    lines.append("</score-partwise>")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# 曲データ
# --------------------------------------------------------------------------
# 伴奏の和音（よく使う形）
C_ = "E3+G3+C4"
G7_ = "F3+G3+B3"
D7_ = "F#3+A3+C4"

# エリーゼのために：主題の 1〜7 小節目（右手・左手）
ELISE_BODY = [
    "E5:1@5 D#5:1@4 E5:1@5 B4:1@2 D5:1@4 C5:1@3",
    "A4:2@1 r:1 C4:1@1 E4:1@2 A4:1@3",
    "B4:2@4 r:1 E4:1@1 G#4:1@2 B4:1@3",
    "C5:2@4 r:1 E4:1@1 E5:1@5 D#5:1@4",
    "E5:1@5 D#5:1@4 E5:1@5 B4:1@2 D5:1@4 C5:1@3",
    "A4:2@1 r:1 C4:1@1 E4:1@2 A4:1@3",
    "B4:2@4 r:1 E4:1@1 C5:1@5 B4:1@4",
]
ELISE_LH = [
    "r:6",
    "A2:1 E3:1 A3:1 r:3",
    "E2:1 E3:1 G#3:1 r:3",
    "A2:1 E3:1 A3:1 r:3",
    "r:6",
    "A2:1 E3:1 A3:1 r:3",
    "E2:1 E3:1 G#3:1 r:3",
]

SONGS = [
    {
        "id": "the_entertainer",
        "title": "エンターテイナー",
        "composer": "Scott Joplin (1902)",
        "note": "A の部分（有名な主題 16 小節）を右手メロディだけに簡略化。左手はラグタイムの「ブン・チャッ」（低音と和音を交互）。"
                "原譜の指示どおり速くしない（Not fast, ♩=80）。指番号はピアノの一般的な運指",
        "melody_name": "右手（ピアノ）", "accomp_name": "左手（ピアノ）",
        "time": (2, 4), "fifths": 0, "pickup": True,
        "tempo_unit": "quarter", "tempo": 80, "bpm_quarter": 80,
        "melody": " | ".join([
            "D4:1@1 D#4:1@2",
            "E4:1@3 C5:2@5 E4:1@1 C5:2@5 E4:1@1 C5:1~@5",
            "C5:4@5 r:1 C5:1@2 D5:1@3 D#5:1@4",
            "E5:1@5 C5:1@2 D5:1@3 E5:2@5 B4:1@1 D5:2@3",
            "C5:4@2 r:2 D4:1@1 D#4:1@2",
            "E4:1@3 C5:2@5 E4:1@1 C5:2@5 E4:1@1 C5:1~@5",
            "C5:2@5 A4:1@3 G4:1@2 F#4:1@1 A4:1@3 C5:1@4 E5:1~@5",
            "E5:2@5 D5:1@4 C5:1@3 A4:1@1 D5:3~@4",
            "D5:4@4 r:2 D4:1@1 D#4:1@2",
            "E4:1@3 C5:2@5 E4:1@1 C5:2@5 E4:1@1 C5:1~@5",
            "C5:4@5 r:1 C5:1@2 D5:1@3 D#5:1@4",
            "E5:1@5 C5:1@2 D5:1@3 E5:2@5 B4:1@1 D5:2@3",
            "C5:4@2 r:2 C5:1@2 D5:1@3",
            "E5:1@4 C5:1@2 D5:1@3 E5:2@4 C5:1@2 D5:1@3 C5:1@2",
            "E5:1@4 C5:1@2 D5:1@3 E5:2@4 C5:1@2 D5:1@3 C5:1@2",
            "E5:1@4 C5:1@2 D5:1@3 E5:2@4 B4:1@1 D5:2@3",
            "C5:4@2 r:4",
        ]),
        "accomp": " | ".join([
            "r:2",
            f"C3:2 {C_}:2 G2:2 {C_}:2",
            f"C3:2 {C_}:2 G2:2 {C_}:2",
            f"C3:2 {C_}:2 G2:2 {G7_}:2",
            f"C3:2 {C_}:2 G2:2 {C_}:2",
            f"C3:2 {C_}:2 G2:2 {C_}:2",
            f"C3:2 {C_}:2 D3:2 {D7_}:2",
            f"G2:2 {G7_}:2 D3:2 {G7_}:2",
            f"G2:2 {G7_}:2 D3:2 {G7_}:2",
            f"C3:2 {C_}:2 G2:2 {C_}:2",
            f"C3:2 {C_}:2 G2:2 {C_}:2",
            f"C3:2 {C_}:2 G2:2 {G7_}:2",
            f"C3:2 {C_}:2 G2:2 {C_}:2",
            f"C3:2 {C_}:2 G2:2 {C_}:2",
            f"C3:2 {C_}:2 G2:2 {C_}:2",
            f"C3:2 {C_}:2 G2:2 {G7_}:2",
            f"C2+C3:2 {C_}:2 r:4",
        ]),
    },
    {
        "id": "canon",
        "title": "カノン",
        "composer": "Johann Pachelbel",
        "note": "第 1 ヴァイオリンの最初の 3 つの旋律（4 分音符・4 分音符・8 分音符の動き）と終わりの形。"
                "原曲は 3 つのヴァイオリンと通奏低音。伴奏は通奏低音（チェロの低音＋チェンバロの和音）を最小限に。♩=66",
        "melody_name": "ヴァイオリン", "accomp_name": "通奏低音（チェロ・チェンバロ）",
        "time": (4, 4), "fifths": 2, "pickup": False,
        "tempo_unit": "quarter", "tempo": 66, "bpm_quarter": 66,
        "melody": " | ".join([
            "F#5:4@5 E5:4@4 D5:4@3 C#5:4@2",
            "B4:4@1 A4:4@1 B4:4@2 C#5:4@3",
            "D5:4@4 C#5:4@3 B4:4@2 A4:4@1",
            "G4:4@3 F#4:4@2 G4:4@3 E4:4@2",
            "D4:2@1 F#4:2@3 A4:2@5 G4:2@4 F#4:2@3 D4:2@1 F#4:2@3 E4:2@2",
            "D4:2@1 B3:2@2 D4:2@1 A4:2@4 G4:2@3 B4:2@5 A4:2@4 G4:2@3",
            "F#4:2@2 D4:2@1 E4:2@2 C#5:2@1 D5:2@2 F#5:2@4 A5:2@5 A4:2@4",
            "B4:2@5 G4:2@3 A4:2@4 F#4:2@2 E4:6@1 C#4:2@2",
            "D4:16@1",
        ]),
        "accomp": " | ".join(
            ["D3+F#3+A3+D4:4 A2+E3+A3+C#4:4 B2+F#3+B3+D4:4 F#2+F#3+A3+C#4:4",
             "G2+G3+B3+D4:4 D2+F#3+A3+D4:4 G2+G3+B3+D4:4 A2+E3+A3+C#4:4"] * 4
            + ["D2+F#3+A3+D4:16"]
        ),
    },
    {
        "id": "saints",
        "title": "聖者の行進",
        "composer": "Traditional（黒人霊歌）",
        "note": "ルイ・アームストロング（1938 年）で有名なニューオーリンズ・ジャズの定番。"
                "メロディはトランペット、伴奏はチューバの低音とピアノの和音の 2 ビート。♩=100。右手はド〜ソの基本位置のまま",
        "melody_name": "トランペット", "accomp_name": "チューバ・ピアノ",
        "time": (4, 4), "fifths": 0, "pickup": True,
        "tempo_unit": "quarter", "tempo": 100, "bpm_quarter": 100,
        "melody": " | ".join([
            "C4:4@1 E4:4@3 F4:4@4",
            "G4:16@5",
            "r:4 C4:4@1 E4:4@3 F4:4@4",
            "G4:16@5",
            "r:4 C4:4@1 E4:4@3 F4:4@4",
            "G4:8@5 E4:8@3",
            "C4:8@1 E4:8@3",
            "D4:16@2",
            "r:4 E4:4@3 E4:4@3 D4:4@2",
            "C4:12@1 C4:4@1",
            "E4:8@3 G4:4@5 G4:4@5",
            "F4:8@4 E4:4@3 F4:4@4",
            "G4:4@5 E4:4@3 C4:4@1 D4:4@2",
            "C4:16@1",
        ]),
        "accomp": " | ".join([
            "r:12",
            "C2:4 E3+G3+C4:4 G2:4 E3+G3+C4:4",
            "C2:4 E3+G3+C4:4 G2:4 E3+G3+C4:4",
            "C2:4 E3+G3+C4:4 G2:4 E3+G3+C4:4",
            "C2:4 E3+G3+C4:4 G2:4 E3+G3+C4:4",
            "C2:4 E3+G3+C4:4 G2:4 E3+G3+C4:4",
            "C2:4 E3+G3+C4:4 G2:4 E3+G3+C4:4",
            "G2:4 F3+G3+B3:4 D3:4 F3+G3+B3:4",
            "G2:4 F3+G3+B3:4 D3:4 F3+G3+B3:4",
            "C2:4 E3+G3+C4:4 G2:4 E3+G3+C4:4",
            "C2:4 E3+G3+Bb3:4 G2:4 E3+G3+Bb3:4",
            "F2:4 F3+A3+C4:4 C3:4 F3+A3+C4:4",
            "C2:4 E3+G3+C4:4 G2:4 F3+G3+B3:4",
            "C2+C3:4 E3+G3+C4:4 r:8",
        ]),
    },
    {
        "id": "happy_birthday",
        "title": "ハッピーバースデー",
        "composer": "Mildred J. Hill / Patty Hill",
        "note": "誕生日の定番。オルゴールの音色で、伴奏は 3 拍子（1 拍目に低音、2・3 拍目に和音）。♩=90",
        "melody_name": "オルゴール（メロディ）", "accomp_name": "オルゴール（伴奏）",
        "time": (3, 4), "fifths": 0, "pickup": True,
        "tempo_unit": "quarter", "tempo": 90, "bpm_quarter": 90,
        "melody": " | ".join([
            "G4:3@1 G4:1@1",
            "A4:4@2 G4:4@1 C5:4@4",
            "B4:8@3 G4:3@1 G4:1@1",
            "A4:4@2 G4:4@1 D5:4@5",
            "C5:8@4 G4:3@1 G4:1@1",
            "G5:4@5 E5:4@3 C5:4@1",
            "B4:4@3 A4:4@2 F5:3@4 F5:1@4",
            "E5:4@3 C5:4@1 D5:4@2",
            "C5:12@1",
        ]),
        "accomp": " | ".join([
            "r:4",
            "C3:4 E3+G3:4 E3+G3:4",
            "G2:4 F3+B3:4 F3+B3:4",
            "G2:4 F3+B3:4 F3+B3:4",
            "C3:4 E3+G3:4 E3+G3:4",
            "C3:4 E3+Bb3:4 E3+Bb3:4",
            "F2:4 A3+C4:4 A3+C4:4",
            "C3:4 E3+G3:4 G2+F3+B3:4",
            "C3+E3+G3+C4:12",
        ]),
    },
    {
        "id": "fur_elise",
        "title": "エリーゼのために",
        "composer": "Ludwig van Beethoven",
        "note": "冒頭の主題を繰り返し記号どおり 2 回。右手の旋律の合間に、左手の分散和音が流れる。"
                "Poco moto（♪=120、♩=60）。指番号はピアノの一般的な運指",
        "melody_name": "右手（ピアノ）", "accomp_name": "左手（ピアノ）",
        "time": (3, 8), "fifths": 0, "pickup": True,
        "tempo_unit": "eighth", "tempo": 120, "bpm_quarter": 60,
        # 楽譜の繰り返し記号のとおり、主題を 2 回（1 回目の終わりから冒頭の E D# に戻る）
        "melody": " | ".join(["E5:1@5 D#5:1@4"] + ELISE_BODY + ["A4:2@3 r:2 E5:1@5 D#5:1@4"] + ELISE_BODY + ["A4:6@3"]),
        "accomp": " | ".join(["r:2"] + ELISE_LH + ["A2:1 E3:1 A3:1 r:3"] + ELISE_LH + ["A2:1 E3:1 A3:1 r:3"]),
    },
]

if __name__ == "__main__":
    for s in SONGS:
        path = os.path.join(ROOT, "songs", f"{s['id']}.musicxml")
        with open(path, "w", encoding="utf-8") as f:
            f.write(build(s))
        print("wrote", os.path.relpath(path, ROOT))
