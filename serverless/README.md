# FitLog AI Gateway

This Cloudflare Worker keeps Anthropic and OpenAI keys out of the public PWA.

1. Copy `.dev.vars.example` to `.dev.vars` for local development.
2. Set `GATEWAY_TOKEN`, `OPENAI_API_KEY`, and/or `ANTHROPIC_API_KEY` as Worker secrets.
3. Update `ALLOWED_ORIGINS` in `wrangler.toml` for the final site origin.
4. Deploy the Worker, then paste its `/` URL and the gateway token into FitLog → 更多 → AI 設定.

Do not commit `.dev.vars` or any provider key.
