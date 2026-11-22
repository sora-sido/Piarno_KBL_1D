import { defineConfig } from "vite";
import { cpSync, createReadStream, existsSync } from "node:fs";
import { resolve, basename } from "node:path";

// 手の認識の実行ファイル（WASM）を、アプリと一緒に /mediapipe-wasm/ から配信する
// （外部の CDN に頼らず、JS と同じバージョンを確実に使うため）
const MEDIAPIPE_WASM_DIR = resolve("node_modules/@mediapipe/tasks-vision/wasm");
function mediapipeWasm() {
  return {
    name: "mediapipe-wasm",
    // 開発サーバー：/mediapipe-wasm/* を node_modules から返す
    configureServer(server) {
      server.middlewares.use("/mediapipe-wasm", (req, res, next) => {
        const file = resolve(MEDIAPIPE_WASM_DIR, basename((req.url || "").split("?")[0]));
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        createReadStream(file).pipe(res);
      });
    },
    // 本番ビルド：dist/mediapipe-wasm にコピー
    closeBundle() {
      if (existsSync(MEDIAPIPE_WASM_DIR)) {
        cpSync(MEDIAPIPE_WASM_DIR, resolve("dist/mediapipe-wasm"), { recursive: true });
      }
    }
  };
}
import { qrcode } from "vite-plugin-qrcode";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Vite設定ファイル
export default defineConfig({
  // 相対パスで出力し、GitHub Pages（https://<user>.github.io/Piarno_KBL_1D/）などのサブパスでも動作させる
  base: "./",
  plugins: [
    // モバイル端末でgetUserMedia(カメラAPI)を使用可能にするためのHTTPS自己署名証明書
    basicSsl(),
    // ターミナル上にアクセス用QRコードを表示
    qrcode(),
    mediapipeWasm()
  ],
  server: {
    // ローカルネットワーク（同一Wi-Fi上のスマートフォンなど）からアクセス可能にする
    host: true,
    port: 5173,
    watch: {
      // 大容量CSVや頻繁なデータ入れ替えによるWindowsファイルロック(EBUSY)を防止
      ignored: ["**/public/dataset/**"]
    }
  }
});
