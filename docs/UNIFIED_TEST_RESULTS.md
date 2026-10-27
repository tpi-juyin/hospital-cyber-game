# 共用程式本機驗證

2026-10-27；版本 1.21.0；本機 darwin/arm64。

- Node.js（Render／本機）與 Cloudflare 分開建置成功，前端均來自同一份 src/client，輸出目錄互不覆蓋。
- DOM／Node 與 Workers 的 TypeScript 檢查通過。
- 116 項自動測試通過，涵蓋共用引擎、UI、Node 雲端密碼登入、主持隔離、Socket.IO、多房間、重連、觀戰、大招及快照。
- 原生 WebSocket 連線模組驗證立即發送、回覆關聯、斷線回報、重連不補送離線連點。
- Cloudflare Wrangler 本機模擬整合測試通過：密碼登入、Origin 檢查、主持推送、觀戰唯讀、雙人倒數與連點、重複序號、暫停與刷新重連、投降、單人 AI／60 秒暫停、活動清空。
- Apple ARM ZIP 完整性、SHA-256、來源產物一致性、啟動執行權限檢查通過。
- 實際解壓至中文與空白路徑，以 PATH=/usr/bin:/bin 與內附 Node.js 24.21.0 執行，主持登入、玩家連線、單人立即開戰、大招集氣／反制／5 秒結束、結算、再戰選角、停止與子程序清理均通過。詳細見 portable-local-results.json。
- npm audit：0 個已知相依套件漏洞。原測試用 happy-dom 存在已知漏洞，已更新至 21.0.4 並重跑測試；不包含在正式遊戲執行產物。

測試修正紀錄：舊 portable smoke 腳本仍用玩家 duration 指令設定時間，與先前已改為主持統一設定的規則不符，改由主持設定 30 秒後再測。Cloudflare 首次整合測試期間本機檔案改動觸發熱更新，對戰依設計中止；停止檔案變動後重跑通過。

這次沒有控制瀏覽器、沒有建立公開測試通道、沒有更新 GitHub／Render／Cloudflare。手機實機版面及音效由使用者接續試玩。本次沒有重跑雲端負載測試；舊 Cloudflare 負載測試見 CLOUDFLARE_INITIAL_TEST_RESULTS.md。

本機支援範圍僅 Apple ARM；Windows／Intel 主持包不再交付。Render 的 Linux 雲端入口保留，雲端發布前仍應在目標平台再驗證。
