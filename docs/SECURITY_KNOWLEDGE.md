# 結算資安知識

版本：1.14.1。內容查核日期：2026-10-07。

結算的「本局資安情報」預設展開，保留兩則約 40～65 字的繁體中文知識。6 個主題各有 2 則，共 12 則；每個主題分別涵蓋原理與實務防護。第一則依攻方本局有效連點最多的基本攻擊選擇，第二則依守方本局有效連點最多的基本防護選擇。並列時優先使用目前選擇的招式；沒有連點時也依目前選擇顯示。一般與大招模式使用相同規則，不以大招遊戲機制取代真實知識。原有防護對應率仍顯示在結算統計。

知識文字位於 `src/shared/protocol.ts` 的 `STRATEGIES`，由 `src/server/engine.ts` 在結束時，從攻守雙方各自主題尚未抽過的提醒中隨機抽出一則並保存到本局狀態；同一主題兩則抽完才重建抽選池。同一局雙方、主持台及重新整理／重連都看到相同的兩則；再戰或重新開房延續房主本次玩家身分的抽選紀錄，不受換角影響。六個主題各有獨立抽選池，其他玩家的房間互不影響；雙人同房仍顯示相同兩則。每兩次同主題抽選涵蓋全部兩則，兩輪交界允許重複。玩家憑證失效、換瀏覽器或伺服器重啟後紀錄重設。以下為改寫所依據的官方資料，並非逐字翻譯。

| 遊戲主題 | 知識重點與依據 |
|---|---|
| 密碼猜測 | 反覆嘗試密碼組合；長且不易預測的密碼提高猜測難度。[Cloudflare：Brute force attack](https://www.cloudflare.com/learning/bots/brute-force-attack/) |
| 多因素驗證 | 密碼之外再驗證另一項憑證，降低密碼外洩後的帳號冒用風險。[CISA：More than a Password](https://www.cisa.gov/ncas/tips/st05-012)、[CISA：Require Multifactor Authentication](https://www.cisa.gov/audiences/small-and-medium-businesses/secure-your-business/require-multifactor-authentication) |
| 流量轟炸 | 大量請求占用伺服器資源，多裝置共同發動的分散式阻斷服務攻擊會影響正常使用者。[Cloudflare：What is a DDoS attack?](https://developers.cloudflare.com/learning-paths/prevent-ddos-attacks/concepts/ddos-attacks/) |
| 流量限制 | 限制一定時間內的請求次數，並調整條件以減少合法使用者被誤擋。[Cloudflare：Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)、[Rate limiting best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/) |
| 漏洞入侵、安全更新 | 軟體缺陷可能讓攻擊者存取檔案或帳號，必須安裝更新才能套用修補。[CISA：Secure Our World](https://www.cisa.gov/be-cyber-smart/report-incident) 的 Update Software 說明 |

本次 CISA 頁面直接擷取回傳 403；其官方頁面內容以搜尋工具的索引內文核對。Cloudflare 頁面以官方文件擷取核對。這些資料用於基礎觀念教學，不代表任何單一措施能防止所有攻擊；畫面原有的多層防護說明保留。

## 新增提醒的來源

- 獨立密碼與密碼管理器：[CISA 密碼說明](https://www.cisa.gov/sites/default/files/2024-09/Secure-Our-World-Passwords-Tip-Sheet.pdf)。
- 抗釣魚 MFA 與安全金鑰：[CISA 抗釣魚 MFA 說明](https://www.cisa.gov/sites/default/files/2023-01/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf)。
- DDoS 分散及過濾流量：[Cloudflare DDoS 防護](https://www.cloudflare.com/learning/ddos/how-to-prevent-ddos-attacks/)。
- 登入嘗試限流：[Cloudflare 限流說明](https://blog.cloudflare.com/rate-limiting/)。
- 軟體盤點與漏洞追蹤：[CISA 供應鏈防護](https://www.cisa.gov/sites/default/files/publications/defending_against_software_supply_chain_attacks_508_1.pdf)。
- 官方更新來源及自動更新：[CISA 更新說明](https://www.cisa.gov/sites/default/files/2024-09/Secure-Our-World-Software-Updates-Tip-Sheet.pdf)、[CISA 供應鏈客戶指南](https://www.cisa.gov/sites/default/files/2023-12/ESF_SECURING_THE_SOFTWARE_SUPPLY_CHAIN_CUSTOMER.pdf)。
