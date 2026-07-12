# FitLog v2 — AI 健身教練（Web App / PWA）

繁體中文個人健身紀錄 App：快速記錄、AI 排課、RM 分析、月曆檢視、AI 週報。純前端、零後端、資料存本地瀏覽器（localStorage），可安裝為 PWA 離線使用。

## 架構（就地升級，無框架、無打包工具）

```
FitLog-Web/
├── index.html · styles.css · sw.js · manifest.webmanifest
├── icons/
└── js/
    ├── data.js    # 資料層：schemaVersion + migrate()、動作庫、單位換算、格式化
    ├── stats.js   # Volume（單邊×2）、PR、1RM/RM（Epley×Brzycki）、週統計、日曆彙總
    ├── ai.js      # Claude API 直連、排課引擎、週報 payload、偏好學習
    ├── ui.js      # 核心 UI：總覽/日曆/訓練/更多、進行中訓練、休息計時
    ├── coach.js   # AI 教練分頁（排課）＋ 週報渲染
    └── main.js    # 進入點
```

全域命名空間 `window.FL`；classic script 依序載入（GitHub Pages / 任何靜態空間皆可）。

## 資料相容（最高優先）

- 沿用同一個 localStorage 鍵 `fitlog.v1`，`schemaVersion` + `migrate()` 逐級升版、永不刪除既有欄位。
- v1 → v2 遷移：動作庫以 nameEn（含別名）比對合併、**保留既有 id**（歷史不斷連）；補單邊/器材/收藏/黑名單欄位；workout 補 feedback；settings 補器材檔/偏好檔/預設目標。
- 匯出 JSON **排除 API Key**（安全）；匯入會保留目前裝置的 Key。
- 已用真實備份驗證：46→52 動作、訓練/報告零遺失、單臂划船正確標記單邊並回溯 ×2。

## v2 功能

- **AI 教練排課**：時間/目標/肌群/身體狀況/自由文字 → Claude 產生今日課表（動作/組數/建議重量/理由），每動作附 2 個替代動作（「換一個」零額外 API 呼叫），一鍵建立今日 Workout。只推薦你器材檔有的、非黑名單的動作。
- **月曆檢視**：每天依主要肌群著色 + 次要肌群小圓點，點日期看當日訓練。
- **RM 系統**：1/3/5/8/10RM 估算（Epley × Brzycki 平均，標示估計值）。
- **單邊動作**：Volume 以總次數 ×2 計。
- **Session 回饋**：完成訓練後快速記錄（很輕鬆…沒完成），供 AI 重量建議與恢復分析。
- **器材檔**：登錄健身房設備，AI 不推薦不存在的器材。
- **收藏 / 黑名單**：影響排課推薦。
- **偏好學習**：常用動作/回饋存偏好檔，每次 AI 呼叫作 context（非微調）。
- **AI 週報升級**：訓練量 / 恢復 / 平衡 / 力量進展（RM 趨勢）/ 弱點 / 下週建議，最多 12 週長期趨勢。
- 補記錄過去訓練、日期時長可編輯、匯出 JSON/CSV、匯入還原。

## 使用

用 Safari 開網址 → 分享 → **加入主畫面**（PWA，離線可用、資料更不易被清）。
更多 → AI 設定 貼上 Claude API Key（platform.claude.com 建立、建議設用量上限）→ 測試連線。

## 更新流程

改檔後上傳覆蓋到 GitHub → 手機把 App 完全關閉再開兩次（Service Worker 抓新版）。每次更新 `sw.js` 的 `CACHE` 版本號會 +1。

版本 2.0（Web）
