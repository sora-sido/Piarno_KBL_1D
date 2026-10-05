import { defineConfig } from "vite";
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
    qrcode()
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
