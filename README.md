### ディレクトリ構成
```
Piarno_KBL_1D/
├── index.html              # メインUI（ビデオ/Canvas重畳、HUD、楽曲ガイド）
├── main.js                 # 推論・1 Euro Filter・打鍵判定・音響合成・楽曲管理・描画
├── positioning.js          # 起動時の手の位置合わせ
├── recorder.js             # 演奏の記録と振り返り（右上の ● ボタン）
├── datalog.js / mic.js     # データの記録（関節座標・机の音・録音）
├── latency.js              # 遅れの測定モード
├── style.css               # 白黒基調のHUD & ネオンフィードバックUIスタイル
├── vite.config.js          # HTTPS対応およびLAN/QRコード公開設定
├── musicxml-song.js        # 楽譜ファイル（MusicXML）から弾く音の列と伴奏を作る
├── instruments.js          # 曲ごとの音色（ヴァイオリン・チェロ・トランペット・チューバ・オルゴール・チェンバロ）
├── songs/
│   ├── shin_takarajima.musicxml # 新宝島の楽譜（アプリはこのファイルから読み込む）
│   └── the_entertainer / canon / saints / happy_birthday / fur_elise .musicxml # 追加した 5 曲（伴奏つき）
├── tap-detector.js         # 打鍵判定の別実装（検証ツール用。アプリ本体ではまだ使っていない）
├── finger-config.js        # 指の定義（tap-detector.js と検証ツールが使用）
├── tools/
│   ├── make_scores.py      # 追加した 5 曲の MusicXML を書き出す（python3 tools/make_scores.py）
│   ├── replay-dataset.mjs  # 録画データを tap-detector.js に通して検出率・誤検知を数える
│   └── replay-baseline.json # 再生結果の基準値
├── scores/                 # 旧版の新宝島の楽譜ページ（現在のアプリのデータとは別物）
├── docs/                   # 変更まとめ・分析ページ
├── public/
│   ├── dataset/            # 指別の打鍵検証用CSVデータセット
│   │   ├── manifest.json   # 読み込み対象CSVの定義ファイル
│   │   └── *.csv           # 各指の時系列フレーム座標・打鍵ラベルデータ
│   ├── models/             # MediaPipe HandLandmarker モデルアセット
│   └── samples/            # 楽器の録音サンプル（出典は samples/CREDITS.md）
```

### 曲の直し方（新宝島）

新宝島の音は `songs/shin_takarajima.musicxml` から読み込んでいる。コードを直す必要はない。

1. `songs/shin_takarajima.musicxml` を MuseScore などの楽譜ソフトで開く
2. 音・リズム・指番号（運指記号）を楽譜上で直す
3. MusicXML（`.musicxml`）で書き出し、同じ名前で上書きする

読み込みの決まり（`musicxml-song.js`）：

- 最初のパートの、1 つ目の声部の音を上から順に弾く。和音は一番上の音だけ、装飾音は使わない
- タイでつながった音は 1 回の打鍵になる
- 指番号は、運指記号があればそれを使う。無い音は ド=1 レ=2 ミ=3 ファ=4 ソ=5（C4〜G4）、
  それより低い音は 1、高い音は 5（♭・♯が付いても同じ指）
- 練習番号（例：「Aメロ」）を付けると、演奏中に曲名の横に表示される
- 小節番号は楽譜のものをそのまま表示する

### 追加した 5 曲（伴奏つき・曲ごとの音色）

| 曲 | テンポ | メロディの音色 | 伴奏 |
|---|---|---|---|
| エンターテイナー（ジョプリン） | ♩=80 | ピアノ | ピアノ（ラグタイムの低音と和音） |
| カノン（パッヘルベル） | ♩=66 | ヴァイオリン | チェロの低音＋チェンバロの和音（通奏低音） |
| 聖者の行進 | ♩=100 | トランペット | チューバの低音＋ピアノの和音（2 ビート） |
| ハッピーバースデー | ♩=90 | オルゴール | オルゴール（3 拍子） |
| エリーゼのために（ベートーヴェン） | ♪=120 | ピアノ | ピアノ（左手の分散和音） |

- 指番号は ド〜ソ 固定ではなく、ピアノで弾くときの指番号（運指記号）をそのまま使う。同じ指でも、打鍵のたびに楽譜どおりの高さの音が鳴る
- 楽譜の 2 つ目のパートが伴奏。打鍵すると、その打鍵から次の打鍵までに楽譜で鳴る伴奏の音が、楽譜のテンポどおりの間隔で流れる
- 音色の組み合わせは `main.js` の `SCORE_SONGS` で変えられる（`melody` / `chord` / `bass`、`"piano"` は Salamander Grand Piano）
- 楽譜は `tools/make_scores.py` で書き出したもの。MuseScore で開いて直し、同じ名前で書き出し直してもよい

### 打鍵判定の検証

`tap-detector.js`（打鍵判定の別実装）は、録画した手の座標を 1 フレームずつ通して結果を確かめられる。
アプリ本体（`main.js`）の判定とはまだ別のもので、両者を比べて良いほうに揃えるための道具として残している。

```bash
npm run replay          # 検出率と誤検知数の表を表示
npm run replay:check    # 基準（tools/replay-baseline.json）を下回ったら失敗
```

- 「打鍵の検出率」は、打鍵の録画（`*_tap_*`）でラベルの付いた打鍵のうち検出できた割合。
- 「誤検知」は、打鍵していない録画（`neg_air` / `neg_idle` / `neg_slide` / `neg_wrist`）で鳴った回数。
- 「二重」は、200ms 未満の間隔で続けて検出した回数（1 回の打鍵で 2 回鳴った可能性）。
- 意図して結果が変わった場合は、表を確かめたうえで `tools/replay-baseline.json` を更新する。

判定パラメータは環境変数 `DET_OPT` に JSON で渡すと上書きして試せる
（例: `DET_OPT='{"hitLockoutMs":150}' npm run replay`）。名前は `tap-detector.js` の `TapDetector` を参照。
