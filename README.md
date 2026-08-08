# FitLog v3 — Performance OS（Web App / PWA）

繁體中文個人健身 App：今日訓練中控台、Claude／OpenAI 排課、RM 分析、InBody 與進度照片、AI 身體分析。訓練資料存在本機，可安裝為 PWA 離線使用；個人模式可直接輸入自己的 OpenAI／Claude API Key。

## v3 重點

- **今日訓練中控台**：Readiness、睡眠／能量／痠痛、快速開始、重複上次、本週負荷與 Body Signal。
- **Performance OS Dock**：底部精簡為今日／訓練／AI／系統四個核心入口；身體、日曆與設定收進具狀態摘要的系統控制中心。
- **雙 AI**：Anthropic Claude、OpenAI Responses API 與自動選擇模式；所有回傳共用 JSON Schema。
- **直接 API Key**：在設定頁輸入 OpenAI／Claude Key，瀏覽器直接呼叫所選供應商；Key 不會放進匯出備份。
- **身體與目標**：增肌／減脂／體態重組／力量目標、InBody 數值與趨勢。
- **照片分析**：照片先在裝置縮圖並移除 EXIF，原始照片存 IndexedDB；使用者明確同意後才連同 InBody 與訓練摘要送給 AI。
- **重量統一**：雙手各拿一個負重的動作以「每手」輸入、儲存時自動合併為總重量（10 + 10 = 20 kg）；單手輪流動作維持單手重量並由 Volume 計算雙側次數。
- **資料相容**：沿用 `fitlog.v1`，schema v2 → v5 不刪除原有訓練；舊的雙手啞鈴紀錄會一次性正規化為總重量。

## 架構（就地升級，無框架、無打包工具）

```
fitlog/
├── index.html · styles.css · sw.js · manifest.webmanifest
├── icons/
├── serverless/           # 選用的自架 Gateway 範例（個人模式不需要）
└── js/
    ├── data.js    # 資料層：schemaVersion + migrate()、動作庫、單位換算、格式化
    ├── stats.js   # 總重量、Volume（單邊次數×2）、PR、1RM/RM、週統計
    ├── ai.js      # OpenAI / Claude 直接 Client、排課引擎、週報 payload、偏好學習
    ├── ui.js      # 今日中控台/日曆/訓練/更多、進行中訓練、休息計時
    ├── coach.js   # AI 教練分頁（排課）＋ 週報渲染
    ├── body.js    # 身體目標、IndexedDB 照片、InBody 與多模態分析
    └── main.js    # 進入點
```

全域命名空間 `window.FL`；classic script 依序載入（GitHub Pages / 任何靜態空間皆可）。

## 資料相容（最高優先）

- 沿用同一個 localStorage 鍵 `fitlog.v1`，`schemaVersion` + `migrate()` 逐級升版、永不刪除既有欄位。
- v1 → v2 遷移：動作庫以 nameEn（含別名）比對合併、**保留既有 id**（歷史不斷連）；補單邊/器材/收藏/黑名單欄位；workout 補 feedback；settings 補器材檔/偏好檔/預設目標。
- 匯出 JSON **排除 OpenAI、Claude、舊 API Key 與 Gateway 存取碼**；匯入會保留目前裝置的金鑰。
- 已用真實備份驗證：46→52 動作、訓練/報告零遺失、單臂划船正確標記單邊並回溯 ×2。

## 延續的 v2 功能

- **AI 教練排課**：時間/目標/肌群/身體狀況/自由文字 → Claude 或 OpenAI 產生今日課表（動作/組數/建議重量/理由），每動作附 2 個替代動作（「換一個」零額外 API 呼叫），一鍵建立今日 Workout。只推薦你器材檔有的、非黑名單的動作。
- **月曆檢視**：每天依主要肌群著色 + 次要肌群小圓點，點日期看當日訓練。
- **RM 系統**：1/3/5/8/10RM 估算（Epley × Brzycki 平均，標示估計值）。
- **重量口徑**：啞鈴飛鳥等雙手獨立負重動作顯示每手重量，但紀錄、CSV、AI 與 Volume 一律使用雙手總重量。
- **單邊動作**：單手／單腳輪流完成時，重量不再重複乘算，Volume 只將雙側次數 ×2。
- **Session 回饋**：完成訓練後快速記錄（很輕鬆…沒完成），供 AI 重量建議與恢復分析。
- **器材檔**：登錄健身房設備，AI 不推薦不存在的器材。
- **收藏 / 黑名單**：影響排課推薦。
- **偏好學習**：常用動作/回饋存偏好檔，每次 AI 呼叫作 context（非微調）。
- **AI 週報升級**：訓練量 / 恢復 / 平衡 / 力量進展（RM 趨勢）/ 弱點 / 下週建議，最多 12 週長期趨勢。
- 補記錄過去訓練、日期時長可編輯、匯出 JSON/CSV、匯入還原。

## 使用

用 Safari 開網址 → 分享 → **加入主畫面**（PWA，離線可用、資料更不易被清）。
到「更多 → AI 設定」輸入 OpenAI 或 Claude API Key，選擇供應商後按「測試連線」。Key 只儲存在目前瀏覽器的 localStorage，適合個人裝置；請勿在共用裝置輸入。

## 更新流程

改檔後上傳覆蓋到 GitHub → 手機把 App 完全關閉再開兩次（Service Worker 抓新版）。每次更新 `sw.js` 的 `CACHE` 版本號會 +1。

版本 3.3（Web，Performance OS Dock＋System Core）
