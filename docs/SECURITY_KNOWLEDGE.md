# 結算資安知識

版本：1.10.1。內容查核日期：2026-10-05。

結算的「本局資安情報」預設展開，保留兩則約 40～60 字的繁體中文知識。第一則依攻方本局有效連點最多的基本攻擊選擇，第二則依守方本局有效連點最多的基本防護選擇。並列時優先使用目前選擇的招式；沒有連點時也依目前選擇顯示。一般與大招模式使用相同規則，不以大招遊戲機制取代真實知識。原有防護對應率仍顯示在結算統計。

知識文字位於 `src/shared/protocol.ts` 的 `STRATEGIES`，由 `src/server/engine.ts` 在結束時選出。以下為改寫所依據的官方資料，並非逐字翻譯。

| 遊戲主題 | 知識重點與依據 |
|---|---|
| 密碼猜測 | 反覆嘗試密碼組合；長且不易預測的密碼提高猜測難度。[Cloudflare：Brute force attack](https://www.cloudflare.com/learning/bots/brute-force-attack/) |
| 多因素驗證 | 密碼之外再驗證另一項憑證，降低密碼外洩後的帳號冒用風險。[CISA：More than a Password](https://www.cisa.gov/ncas/tips/st05-012)、[CISA：Require Multifactor Authentication](https://www.cisa.gov/audiences/small-and-medium-businesses/secure-your-business/require-multifactor-authentication) |
| 流量轟炸 | 大量請求占用伺服器資源，多裝置共同發動的分散式阻斷服務攻擊會影響正常使用者。[Cloudflare：What is a DDoS attack?](https://developers.cloudflare.com/learning-paths/prevent-ddos-attacks/concepts/ddos-attacks/) |
| 流量限制 | 限制一定時間內的請求次數，並調整條件以減少合法使用者被誤擋。[Cloudflare：Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)、[Rate limiting best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/) |
| 漏洞入侵、安全更新 | 軟體缺陷可能讓攻擊者存取檔案或帳號，必須安裝更新才能套用修補。[CISA：Secure Our World](https://www.cisa.gov/be-cyber-smart/report-incident) 的 Update Software 說明 |

本次 CISA 頁面直接擷取回傳 403；其官方頁面內容以搜尋工具的索引內文核對。Cloudflare 頁面以官方文件擷取核對。這些資料用於基礎觀念教學，不代表任何單一措施能防止所有攻擊；畫面原有的多層防護說明保留。
