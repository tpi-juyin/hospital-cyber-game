# 共用程式整理（1.21.0）

## 唯一維護來源

以 `hospital-cyber-game` 為唯一來源，不再複製前端或引擎至另一個 Cloudflare 專案。現階段尚未同步 GitHub 或雲端。

- `src/client/`：所有畫面、動畫、音效、觀戰、儀表板、手機橫向、全螢幕與暫停提示。
- `src/shared/`：操作與狀態型別、資安知識、版本。
- `src/server/engine.ts`：唯一戰鬥／AI／房間／重連引擎，另提供 Cloudflare 使用的快照介面。
- `src/server/login-page.ts`：兩個雲端共用登入頁。
- `src/client/transport.ts`：Node 的 Socket.IO 與 HTTP 戰況讀取。
- `src/client/transport-cloudflare.ts`：Cloudflare 的即時 WebSocket 操作與戰況推送；不補送離線操作。

Vite 的 cloudflare mode 只替換連線模組，畫面依舊來自相同檔案。型別檢查分開驗證 DOM／Node 與 Workers runtime。

## 三種入口

| 入口 | 程式 | 狀態／驗證 |
|---|---|---|
| 本機 Apple ARM | scripts/launch.mjs → dist-server/game.cjs | 記憶體；啟動器私有網址換 Cookie，公開通道僅連玩家入口 |
| Render | src/server/cloud.ts → dist-server/cloud.cjs | 記憶體；HOST_PASSWORD 登入，主控頁與玩家同網域 |
| Cloudflare | src/server/worker.ts | Durable Object 快照；HOST_PASSWORD 登入，獨立 Cookie 與來源檢查 |

Node 與 Worker 的 HTTP／WebSocket／Cookie／儲存生命週期仍由平台入口負責，避免把平台限定 API 塞進共用引擎。登入密碼格式為 16–256 字元，兩邊維持原有安全策略；並未為統一而降低驗證要求。

Render／本機重啟清空活動。Cloudflare 保留設定及等待／結束的快照，服務重啟時進行中的房間不計勝負。指揮中心依編譯的連線模組顯示正確說明。版本都取 package.json；同版本可分開發布。

## 建置與發布隔離

`npm run build`／`build:node` 輸出 dist 與 dist-server；`build:cloudflare` 輸出 dist-cloudflare。後者不覆蓋前者；Apple ARM 主持包只收 Node 產物、執行環境與文件，不包含 Worker、秘密或開發套件。

Render 的 render.yaml 保留手動部署。Cloudflare 使用 wrangler.jsonc，Worker 名稱仍為 hospital-cyber-game，保留 GameEvent 與原 v1 migration，日後發布可沿用原 Durable Object，不重建活動資料。帳號子網域變更由後台決定，遊戲沒有寫死網域。

只有明確執行 deploy:cloudflare 才會發布；build、test、dev:cloudflare、package 都不會更新雲端。部署前需另取得使用者指示。不要將舊的本機 HOST_PASSWORD 記錄覆蓋後台新密碼。

## 本機支援範圍

僅 Apple 晶片 Mac（darwin/arm64）；移除 Windows .cmd、Windows／Intel Mac 打包目標、舊主持包與下載快取，以及 Railway 部署文件。Render 的 Linux runtime 不受本機限制影響。舊 docs/plans 與測試報告為歷史紀錄，不代表仍交付那些平台。

不重新設計遊戲、不更動戰鬥數值、不切換雲端站、不自動部署、不重建公開通道。
