const OPENAI_MODELS = new Set(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
const ANTHROPIC_MODELS = new Set(["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"]);

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const allowOrigin = allowed.includes("*") || allowed.includes(origin) ? origin || "*" : allowed[0] || "";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
}

function bearer(request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function chooseProvider(requested, env) {
  if (requested === "openai" && env.OPENAI_API_KEY) return "openai";
  if (requested === "anthropic" && env.ANTHROPIC_API_KEY) return "anthropic";
  if (requested && requested !== "auto") throw new Error(`${requested} 尚未在 Gateway 設定`);
  if (env.OPENAI_API_KEY) return "openai";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  throw new Error("Gateway 尚未設定 AI API Key");
}

function safeModel(provider, requested, mode) {
  if (provider === "openai") {
    if (requested && OPENAI_MODELS.has(requested)) return requested;
    return mode === "vision" ? "gpt-5.6-terra" : "gpt-5.6-luna";
  }
  if (requested && ANTHROPIC_MODELS.has(requested)) return requested;
  return "claude-sonnet-5";
}

function parseDataUrl(url) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url || "");
  if (!match) throw new Error("圖片格式不支援");
  return { mediaType: match[1], data: match[2] };
}

function extractOpenAIText(body) {
  for (const item of body.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) if (part.type === "output_text" && part.text) return part.text;
  }
  return "";
}

async function callOpenAI(payload, model, env) {
  const content = [{ type: "input_text", text: payload.input || "" }];
  for (const image of payload.images || []) {
    parseDataUrl(image);
    content.push({ type: "input_image", image_url: image, detail: "auto" });
  }
  const body = {
    model,
    instructions: payload.system || "",
    input: [{ role: "user", content }],
    text: {
      format: {
        type: "json_schema", name: "fitlog_output", strict: true, schema: payload.schema,
      },
    },
    max_output_tokens: Math.min(Math.max(Number(payload.maxOutputTokens) || 4096, 64), 12000),
    store: false,
    safety_identifier: env.SAFETY_IDENTIFIER || "fitlog-owner",
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `OpenAI HTTP ${response.status}`);
  const text = extractOpenAIText(result);
  if (!text) throw new Error("OpenAI 未回傳可用內容");
  return {
    content: JSON.parse(text), model: result.model || model,
    usage: { input_tokens: result.usage?.input_tokens || 0, output_tokens: result.usage?.output_tokens || 0 },
  };
}

async function callAnthropic(payload, model, env) {
  const content = [];
  for (const image of payload.images || []) {
    const parsed = parseDataUrl(image);
    content.push({ type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } });
  }
  content.push({ type: "text", text: payload.input || "" });
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model, system: payload.system || "", max_tokens: Math.min(Number(payload.maxOutputTokens) || 4096, 12000),
      output_config: { format: { type: "json_schema", schema: payload.schema } },
      messages: [{ role: "user", content }],
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `Anthropic HTTP ${response.status}`);
  const text = (result.content || []).find((x) => x.type === "text")?.text;
  if (!text) throw new Error("Claude 未回傳可用內容");
  return { content: JSON.parse(text), model: result.model || model, usage: result.usage || {} };
}

const TEST_SCHEMA = {
  type: "object", additionalProperties: false, required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
    if (!env.GATEWAY_TOKEN) return json({ error: "Gateway token is not configured" }, 503, cors);
    if (bearer(request) !== env.GATEWAY_TOKEN) return json({ error: "Unauthorized" }, 401, cors);

    const length = Number(request.headers.get("content-length") || 0);
    if (length > 9_000_000) return json({ error: "Payload too large" }, 413, cors);

    try {
      const payload = await request.json();
      const provider = chooseProvider(payload.provider, env);
      const mode = payload.mode === "vision" ? "vision" : "text";
      const model = safeModel(provider, payload.model, mode);
      const normalized = payload.operation === "test"
        ? { ...payload, system: "Return JSON only.", input: "Connection test", schema: TEST_SCHEMA, maxOutputTokens: 64 }
        : payload;
      if (!normalized.schema || typeof normalized.schema !== "object") throw new Error("缺少輸出 schema");
      if ((normalized.images || []).length > 4) throw new Error("一次最多分析 4 張照片");
      const result = provider === "openai"
        ? await callOpenAI(normalized, model, env)
        : await callAnthropic(normalized, model, env);
      return json({ ...result, provider }, 200, cors);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "AI request failed" }, 400, cors);
    }
  },
};
