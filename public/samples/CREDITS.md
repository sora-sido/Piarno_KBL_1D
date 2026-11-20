# 楽器サンプルの出典

`instruments.js` が読み込む音源。どれも 1 音ずつ録音（または音源化）された mp3 で、Tone.Sampler が間の高さを補う。

| フォルダ | 楽器 | 出典 | ライセンス |
|---|---|---|---|
| violin / trumpet / tuba | ヴァイオリン・トランペット・チューバ | [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments)（Nicholaus P. Brosowsky）。録音は VSCO 2 Community Edition | MIT（リポジトリ） |
| cello | チェロ | 同上。録音は Freesound「12408__flcellogrl__real-cello-notes」 | MIT（リポジトリ）／元録音は Freesound の表示に従う |
| music_box / harpsichord / electric_piano_1 / electric_piano_2 | オルゴール・チェンバロ・電子ピアノ（Electric Piano 1・2） | FluidR3_GM（Frank Wen）を [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts)（Benjamin Gleitzman）で mp3 にしたもの | CC BY 3.0 |

ピアノ（Salamander Grand Piano）は今までどおり https://tonejs.github.io/audio/salamander/ から読み込む。
