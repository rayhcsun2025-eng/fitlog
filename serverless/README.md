# FitLog AI Gateway（選用範例）

FitLog v3.1 預設採「直接輸入 API Key」個人模式，不需要部署本目錄。這裡保留作為未來公開網站或多人使用時的安全 Gateway 範例；目前前端設定頁不會呼叫它。

This Cloudflare Worker keeps Anthropic and OpenAI keys out of the public PWA.

1. Copy `.dev.vars.example` to `.dev.vars` for local development.
2. Set `GATEWAY_TOKEN`, `OPENAI_API_KEY`, and/or `ANTHROPIC_API_KEY` as Worker secrets.
3. Update `ALLOWED_ORIGINS` in `wrangler.toml` for the final site origin.
4. Deploy the Worker. 若未來要切回 Gateway 模式，需再將 `js/ai.js` 的 Client 接到此 Worker。

Do not commit `.dev.vars` or any provider key.
