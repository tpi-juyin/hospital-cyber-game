# Render 雲端主持

## 部署設定

- 使用私人 GitHub 儲存庫，Render 僅授權讀取此儲存庫。
- Node Web Service、Free、Singapore、單一服務實例。
- Node.js：24.21.0（`NODE_VERSION`）。
- Build：`npm ci --include=dev && npm run build`
- Start：`npm run start:cloud`
- Health check：`/api/health`
- `HOST_PASSWORD`：主持人自行在 Render Environment 設定 16～256 個字元的密碼，使用密碼管理器產生，不寫進 GitHub 或對話。
- 公開網址讀取 Render 的 `RENDER_EXTERNAL_URL`，連接埠讀取 `PORT`。自訂網域需額外設定 `PUBLIC_ORIGIN` 為完整 HTTPS origin，不能帶路徑。
- `render.yaml` 提供同樣設定；關閉自動部署，避免活動途中因 push 重啟。

## 活動流程

1. 活動前先開 `/host` 喚醒免費服務，登入主持台。
2. 每次服務重啟預設開放新玩家加入，並開啟大招模式；主持人可依活動需要暫停加入或關閉大招。
3. 分享首頁或 QR Code 給玩家；主持密碼不要提供給玩家。
4. 「結束活動」會中止對局、不計勝負並清空房間與玩家，保留服務與網址；可再次開放加入。
5. 離開共用電腦前按「登出」。登入期限為 8 小時，重啟服務亦會使登入失效。

## 免費方案與限制

- Render 免費服务閒置 15 分鐘休眠，喚醒可能約需一分鐘；平台亦可能重啟服務。
- 房間、玩家與主持設定皆在記憶體，重啟／休眠／重新部署後不保留。
- Hobby 工作區每月 5 GB 對外流量，包含 WebSocket 戰況資料；無付款方式且額度耗盡時可能暫停服務。
- 正式活動前以實際手機與網路彩排。原本 30 人測試為本機模擬，不能視為 Render 免費機器已通過 30 人實測。
- 來源：https://render.com/docs/free 、https://render.com/docs/outbound-bandwidth 。查閱日期：2026-10-06。

## 驗證範圍

雲端模式的本機 HTTP／WebSocket 測試涵蓋登入、Cookie 安全屬性、來源驗證、未登入拒絕、錯誤密碼、嘗試頻率、登出／過期、結束與重開活動。部署及瀏覽器實測結果另記於 TEST_RESULTS.md。
