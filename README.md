### ディレクトリ構成
```
Piarno_KBL_1D/
├── index.html              # メインUI（ビデオ/Canvas重畳、HUD、楽曲ガイド）
├── main.js                 # カメラ・推論ループ・右手選択・音響合成・楽曲管理・描画
├── tap-detector.js         # 打鍵判定（平滑化・特徴量・打鍵ステート）。DOM 非依存
├── finger-config.js        # 指の定義（ランドマーク番号・音）
├── threshold-model.js      # CSV のパースと指別閾値の導出（現在の判定では参考値）
├── recorder.js             # 検証用データの録画（URL に ?record を付けたときだけ有効）
├── style.css               # 白黒基調のHUD & ネオンフィードバックUIスタイル
├── vite.config.js          # HTTPS対応およびLAN/QRコード公開設定
├── tools/
│   ├── replay-dataset.mjs  # 録画データを判定コードに通して検出率・誤検知を数える
│   └── replay-baseline.json # 再生結果の基準値
├── public/
│   ├── dataset/            # 指別の打鍵検証用CSVデータセット
│   │   ├── manifest.json   # 読み込み対象CSVの定義ファイル
│   │   ├── *.csv           # 各指の時系列フレーム座標・打鍵ラベルデータ
│   │   └── recordings/     # ?record で録画した全 21 ランドマークの CSV を置く場所（任意）
│   └── models/             # MediaPipe HandLandmarker モデルアセット
```

### 打鍵判定の検証

打鍵判定（`tap-detector.js`）は、録画した手の座標を 1 フレームずつ通して結果を確かめられる。
判定ロジックを変えたら、必ず実行して検出率と誤検知数を確認する。

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

### 検証用データの録画

URL の末尾に `?record` を付けて開くと、左上に録画パネルが出る
（例: `https://localhost:5173/?record`）。

1. 通常どおり「スタート」でカメラを起動する。
2. パネルで録画の種類（打鍵 / 空中 / 静止 / 滑らせる / 手首 / ほかの指で叩く / 自由）と対象の指を選ぶ。
3. 「録画開始」を押し、選んだ動きを 20〜40 秒ほど続ける。録画中はアプリの音と打鍵判定が止まる。
4. 「停止して保存」を押すと `rec_<指>_<種類>_<日時>.csv` がダウンロードされる。
5. その CSV を `public/dataset/recordings/` に置くと、`npm run replay` の対象に加わる。

記録するのは、右手の全 21 ランドマーク（x, y, z）、検出した手の数、マイクの音量。
マイクを許可すると、机を叩く音の立ち上がりを打鍵の正解として使う（判定ロジックの出力に頼らない正解になる）。
マイクを使わない場合、打鍵の録画は検出数だけが表示される。
