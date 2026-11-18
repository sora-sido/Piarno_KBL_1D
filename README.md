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
├── tap-detector.js         # 打鍵判定の別実装（検証ツール用。アプリ本体ではまだ使っていない）
├── finger-config.js        # 指の定義（tap-detector.js と検証ツールが使用）
├── tools/
│   ├── replay-dataset.mjs  # 録画データを tap-detector.js に通して検出率・誤検知を数える
│   └── replay-baseline.json # 再生結果の基準値
├── scores/                 # 楽譜ページ（新宝島）
├── docs/                   # 変更まとめ・分析ページ
├── public/
│   ├── dataset/            # 指別の打鍵検証用CSVデータセット
│   │   ├── manifest.json   # 読み込み対象CSVの定義ファイル
│   │   └── *.csv           # 各指の時系列フレーム座標・打鍵ラベルデータ
│   └── models/             # MediaPipe HandLandmarker モデルアセット
```

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
