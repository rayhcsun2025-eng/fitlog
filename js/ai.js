/* =====================================================================
   FitLog v3 — AI 引擎（AI Coach）
   Claude / OpenAI 共用 AI 層。個人直接模式：金鑰只存此裝置，
   瀏覽器直接呼叫供應商；支援文字、圖片與 Structured Output。
   ===================================================================== */
"use strict";
window.FL = window.FL || {};

(function (FL) {
  const CLAUDE_MODELS = {
    "claude-sonnet-5":  { name: "Sonnet（推薦）", short: "Sonnet", hint: "分析品質與成本的最佳平衡，每次約 NT$0.5–2。" },
    "claude-opus-4-8":  { name: "Opus（最強）",   short: "Opus",   hint: "最深入的分析，每次約 NT$1–4。" },
    "claude-haiku-4-5": { name: "Haiku（最省）",  short: "Haiku",  hint: "最快最省，深度較淺，每次約 NT$0.2–0.8。" },
  };
  const OPENAI_MODELS = {
    "gpt-5.6-luna":  { name: "GPT-5.6 Luna（快速省用量）", short: "5.6 Luna" },
    "gpt-5.6-terra": { name: "GPT-5.6 Terra（推薦）", short: "5.6 Terra" },
    "gpt-5.6-sol":   { name: "GPT-5.6 Sol（最深入）", short: "5.6 Sol" },
  };
  const AI_PROVIDERS = {
    auto: "自動選擇", openai: "OpenAI", anthropic: "Anthropic Claude",
  };

  // ---- 個人直接 API Client ----
  function openAIKey() { return (FL.db.settings.openaiApiKey || "").trim(); }
  function anthropicKey() { return (FL.db.settings.anthropicApiKey || FL.db.settings.apiKey || "").trim(); }
  function selectedProvider() {
    const requested = FL.db.settings.aiProvider || "auto";
    if (requested === "openai") {
      if (!openAIKey()) throw new Error("請先輸入 OpenAI API Key");
      return "openai";
    }
    if (requested === "anthropic") {
      if (!anthropicKey()) throw new Error("請先輸入 Claude API Key");
      return "anthropic";
    }
    if (openAIKey()) return "openai";
    if (anthropicKey()) return "anthropic";
    throw new Error("請先輸入 OpenAI 或 Claude API Key");
  }
  function selectedModel(provider, mode) {
    if (provider === "openai") return mode === "vision"
      ? FL.db.settings.openaiVisionModel : FL.db.settings.openaiModel;
    if (provider === "anthropic") return FL.db.settings.anthropicModel || FL.db.settings.model;
    return null;
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
  async function apiFetch(url, options, provider) {
    let lastErr = "AI 服務暫時無法使用，請稍後再試";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2000 * attempt));
      let res;
      try {
        res = await fetch(url, options);
      } catch (_) { lastErr = "網路連線失敗，請確認網路後重試"; continue; }
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      if (res.status === 401 || res.status === 403) throw new Error(`${provider === "openai" ? "OpenAI" : "Claude"} API Key 無效`);
      if (res.status === 413) throw new Error("照片容量過大，請減少照片後重試");
      if (res.status === 429 || res.status >= 500) {
        lastErr = res.status === 429 ? "請求過於頻繁，請稍後再試" : `AI 服務暫時無法使用（${res.status}）`;
        continue;
      }
      throw new Error(json.error?.message || `HTTP ${res.status}`);
    }
    throw new Error(lastErr);
  }
  async function callOpenAI(payload, model) {
    const content = [{ type: "input_text", text: payload.input || "" }];
    for (const image of payload.images || []) {
      parseDataUrl(image);
      content.push({ type: "input_image", image_url: image, detail: "auto" });
    }
    const body = {
      model,
      instructions: payload.system || "",
      input: [{ role: "user", content }],
      max_output_tokens: Math.min(Math.max(Number(payload.maxOutputTokens) || 4096, 64), 12000),
      store: false,
      safety_identifier: "fitlog-personal",
    };
    if (payload.schema) body.text = { format: {
      type: "json_schema", name: "fitlog_output", strict: true, schema: payload.schema,
    } };
    const result = await apiFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": `Bearer ${openAIKey()}` },
      body: JSON.stringify(body),
    }, "openai");
    const text = extractOpenAIText(result);
    if (!text) throw new Error("OpenAI 未回傳可用內容");
    return {
      text, model: result.model || model,
      usage: { input_tokens: result.usage?.input_tokens || 0, output_tokens: result.usage?.output_tokens || 0 },
    };
  }
  async function callAnthropic(payload, model) {
    const content = [];
    for (const image of payload.images || []) {
      const parsed = parseDataUrl(image);
      content.push({ type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } });
    }
    content.push({ type: "text", text: payload.input || "" });
    const body = {
      model, system: payload.system || "",
      max_tokens: Math.min(Math.max(Number(payload.maxOutputTokens) || 4096, 1), 12000),
      messages: [{ role: "user", content }],
    };
    if (payload.schema) body.output_config = { format: { type: "json_schema", schema: payload.schema } };
    const result = await apiFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-api-key": anthropicKey(),
        "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    }, "anthropic");
    const text = (result.content || []).find((x) => x.type === "text")?.text;
    if (!text) throw new Error("Claude 未回傳可用內容");
    return { text, model: result.model || model, usage: result.usage || {} };
  }
  async function testKey() {
    const provider = selectedProvider();
    const model = selectedModel(provider, "text");
    const payload = { input: "Reply with OK.", maxOutputTokens: 128 };
    const result = provider === "openai" ? await callOpenAI(payload, model) : await callAnthropic(payload, model);
    return { provider, model: result.model };
  }
  async function structured(system, userText, schema, model, maxTokens, options) {
    const opts = options || {};
    const mode = opts.images && opts.images.length ? "vision" : "text";
    const provider = opts.provider || selectedProvider();
    const pickedModel = model || selectedModel(provider, mode);
    const payload = { system, input: userText, schema, images: opts.images || [], maxOutputTokens: maxTokens || 8192 };
    const result = provider === "openai" ? await callOpenAI(payload, pickedModel) : await callAnthropic(payload, pickedModel);
    let content;
    try { content = JSON.parse(result.text); }
    catch (_) { throw new Error("AI 回應格式異常，請再試一次"); }
    if (!content || typeof content !== "object") throw new Error("AI 回應格式異常，請再試一次");
    return { content, usage: result.usage || {}, provider, model: result.model || pickedModel };
  }

  // ---- 偏好學習（Preference Profile）----
  // 由使用紀錄推導：常用動作、常用重量、最近回饋；存 settings、每次呼叫作 context。
  function updatePreferenceProfile() {
    const usage = {};
    for (const w of FL.completedWorkouts())
      for (const en of w.entries) usage[en.exerciseId] = (usage[en.exerciseId] || 0) + 1;
    const top = Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([id, n]) => { const ex = FL.exerciseById(id); return ex ? { name: ex.nameEn, count: n } : null; })
      .filter(Boolean);
    const recentFeedback = FL.completedWorkouts()
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime)).slice(0, 3)
      .map((w) => w.feedback).filter(Boolean);
    FL.db.settings.preferenceProfile = { frequentExercises: top, recentFeedback, updatedAt: new Date().toISOString() };
    FL.save();
  }

  // ---- 排課 context 組裝（本地，零 API 成本）----
  function availableEquipment() {
    const p = FL.db.settings.equipmentProfile || {};
    return Object.keys(p).filter((k) => p[k]);
  }
  function round1(v) { return Math.round(v * 10) / 10; }

  function candidateExercises(targetGroups) {
    const equip = new Set(availableEquipment());
    return FL.db.exercises.filter((ex) => {
      if (ex.isArchived || ex.isBlacklisted) return false;
      if (!equip.has(ex.equipment)) return false;
      if (targetGroups && targetGroups.length && !targetGroups.includes(ex.muscleGroup)) return false;
      return true;
    }).map((ex) => {
      const last = FL.lastPerformance(ex.id, null);
      const e1rm = FL.bestE1RM(FL.allSetsOf(ex.id, null));
      return {
        id: ex.id, name_zh: ex.nameZh, name_en: ex.nameEn,
        muscle_group: ex.muscleGroup, movement_pattern: ex.movementPattern,
        equipment: ex.equipment, is_unilateral: ex.isUnilateral, is_favorite: ex.isFavorite,
        weight_input_mode: ex.weightInputMode || "total",
        last: last ? {
          weight_kg: last.sets[last.sets.length - 1].weightKg,
          weight_kg_per_side: ex.weightInputMode === "perSide" ? FL.inputWeightKg(last.sets[last.sets.length - 1].weightKg, ex) : null,
          reps: last.sets[last.sets.length - 1].reps,
        } : null,
        best_e1rm_kg: e1rm ? round1(e1rm) : null,
      };
    });
  }

  function recentContext() {
    const windows = {};
    for (const d of [1, 3, 7, 14]) {
      const list = FL.workoutsInDays(d);
      const byMuscle = {};
      for (const w of list)
        for (const en of w.entries) {
          const ex = FL.exerciseById(en.exerciseId);
          if (!ex) continue;
          byMuscle[ex.muscleGroup] = round1((byMuscle[ex.muscleGroup] || 0) + FL.entryVolume(en));
        }
      windows[`last_${d}d`] = { workout_count: list.length, volume_by_muscle: byMuscle };
    }
    const lastWorkout = FL.completedWorkouts().sort((a, b) => new Date(b.startTime) - new Date(a.startTime))[0];
    const daysSince = lastWorkout ? round1((Date.now() - new Date(lastWorkout.startTime)) / 86400000) : null;
    return {
      training_age_weeks: FL.trainingAgeWeeks(),
      days_since_last_workout: daysSince,
      windows,
      recent_feedback: (FL.db.settings.preferenceProfile || {}).recentFeedback || [],
      frequent_exercises: (FL.db.settings.preferenceProfile || {}).frequentExercises || [],
    };
  }

  // ---- 排課 Prompt / Schema ----
  const PLANNER_SYSTEM = `你是一位資深私人健身教練（Personal Training Assistant），為長期訓練者安排「今日課表」。你不是聊天工具，是排課助手。

規則：
1. 全部繁體中文（台灣用語）；動作名稱用「中文（English）」格式。
2. **只能從 candidate_exercises 提供的清單中挑動作**，並用其 id 指定（exercise_id 必須是清單裡的 id）。不得自創清單外的動作、不得推薦使用者沒有的器材。
3. 每個動作附 2 個「替代動作（alternatives）」，同樣來自清單、同肌群相近刺激——供使用者「換一個」用。
4. 建議重量（suggested_weight_kg）以該動作 last（上次表現）與 best_e1rm_kg 為基礎，依目標與身體狀況調整，並在 rationale 說明理由；沒有歷史資料就給保守估計或留 null 並說明。
5. 參考 recent context：近 1/3/7/14 天已練肌群避免過度、疲勞/痠痛時降量、恢復不足避免重複刺激同肌群。
6. 課表動作數與組數要符合使用者給的時間（30/45/60/90 分鐘，組間休息假設 90 秒）。
7. 判斷漸進超負荷（progression_note）：對常練動作給「加重/加次/維持/減量(Deload)」的方向。
8. 若使用者自由文字提到不適（如肩膀痛），必須在 warnings 說明並避開相關動作。
9. 語氣：專業、直接、可執行。
10. 精簡：每個 rationale 與 alternative.reason 控制在一句話（約 30 字內）；動作數配合時間（30分約3-4個、45分約4-5個、60分約5-6個、90分約6-8個），不要過多。
11. 所有 suggested_weight_kg 一律回傳「總外部重量」。若 weight_input_mode=perSide，代表兩手各自持重，總重量為每手重量 ×2；可在 rationale 同時標示每手重量。`;

  const PLANNER_SCHEMA = {
    type: "object", additionalProperties: false,
    required: ["focus_summary", "warnings", "exercises", "estimated_minutes", "progression_note"],
    properties: {
      focus_summary: { type: "string", description: "一句話說明今天練什麼與為什麼" },
      warnings: { type: "array", items: { type: "string" }, description: "注意事項；無則空陣列" },
      estimated_minutes: { type: "integer" },
      progression_note: { type: "string", description: "漸進超負荷方向判斷" },
      exercises: {
        type: "array", description: "今日動作清單，依訓練順序",
        items: {
          type: "object", additionalProperties: false,
          required: ["exercise_id", "name_zh", "name_en", "muscle_group", "sets", "reps", "suggested_weight_kg", "rationale", "alternatives"],
          properties: {
            exercise_id: { type: "string", description: "必須是 candidate_exercises 中的 id" },
            name_zh: { type: "string" }, name_en: { type: "string" }, muscle_group: { type: "string" },
            sets: { type: "integer" }, reps: { type: "string", description: "如 8-10" },
            suggested_weight_kg: { type: ["number", "null"], description: "總外部重量 kg；perSide 動作為兩手重量合計" },
            rationale: { type: "string", description: "動作與重量的理由" },
            alternatives: {
              type: "array", description: "2 個替代動作，來自清單、同肌群",
              items: {
                type: "object", additionalProperties: false,
                required: ["exercise_id", "name_zh", "name_en", "reason"],
                properties: {
                  exercise_id: { type: "string" }, name_zh: { type: "string" },
                  name_en: { type: "string" }, reason: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  };

  async function generatePlan(input) {
    // input: { minutes, goal, muscleMode:'ai'|groups[], bodyState, freeText }
    const targetGroups = Array.isArray(input.muscleMode) ? input.muscleMode : null;
    const candidates = candidateExercises(targetGroups);
    if (!candidates.length) throw new Error("依你的器材與肌群設定，沒有可用動作。請到「更多 → 器材檔」放寬設定。");
    const payload = {
      request: {
        minutes: input.minutes, goal: input.goal,
        muscle: targetGroups ? targetGroups : "AI 決定",
        body_state: input.bodyState, note: input.freeText || "",
        unit: FL.db.settings.unit,
      },
      recent: recentContext(),
      candidate_exercises: candidates,
    };
    const user = `請依以下資料安排今日課表：\n${JSON.stringify(payload)}`;
    const res = await structured(PLANNER_SYSTEM, user, PLANNER_SCHEMA);
    return res;
  }

  // ---- 每週報告 ----
  function isoDate(d) { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  function weekdayMon1(dateStr) { return ((new Date(dateStr).getDay() + 6) % 7) + 1; }

  function buildWeeklyPayload(refDate) {
    const ws = FL.weekStartOf(refDate);
    const first = FL.completedWorkouts().map((w) => new Date(w.startTime)).sort((a, b) => a - b)[0];
    let span = 12;
    if (first) span = Math.max(1, Math.min(12, Math.round((ws - FL.weekStartOf(first)) / (7 * 86400000)) + 1));

    const weekW = FL.workoutsInWeek(refDate);
    const prevW = FL.workoutsInWeek(new Date(ws.getTime() - 86400000));
    const prevDist = Object.fromEntries(FL.muscleDistribution(prevW).map((d) => [d.group, d.volume]));

    const groupAgg = {}, exAgg = {};
    const bal = FL.movementBalance(weekW);
    for (const w of weekW)
      for (const en of w.entries) {
        const ex = FL.exerciseById(en.exerciseId);
        if (!ex) continue;
        const g = (groupAgg[ex.muscleGroup] ||= { sets: 0, vol: 0, days: new Set() });
        const a = (exAgg[en.exerciseId] ||= { vol: 0, sets: [] });
        for (const s of en.sets) {
          if (!s.completedAt || s.setType === "warmup") continue;
          const v = s.weightKg * s.reps * FL.unilateralMult(ex);
          g.sets++; g.vol += v; g.days.add(weekdayMon1(w.startTime));
          a.vol += v; a.sets.push(s);
        }
      }

    // 重點動作：每肌群 volume 最高的 1–2 個 + 逐週 e1RM
    const byGroup = {};
    for (const [exId, a] of Object.entries(exAgg)) {
      const ex = FL.exerciseById(exId);
      if (!ex || !a.sets.length) continue;
      (byGroup[ex.muscleGroup] ||= []).push({ ex, vol: a.vol, sets: a.sets });
    }
    const keyExercises = [];
    for (const list of Object.values(byGroup)) {
      list.sort((x, y) => y.vol - x.vol);
      for (const item of list.slice(0, 2)) {
        const top = item.sets.reduce((m, s) => (s.weightKg > m.weightKg ? s : m), item.sets[0]);
        const trend = [];
        for (let i = span - 1; i >= 0; i--) {
          const ref = new Date(refDate); ref.setDate(ref.getDate() - i * 7);
          let best = 0;
          for (const w of FL.workoutsInWeek(ref))
            for (const en of w.entries)
              if (en.exerciseId === item.ex.id)
                for (const s of en.sets) {
                  const e = s.completedAt && s.setType !== "warmup" ? FL.estimated1RM(s.weightKg, s.reps) : null;
                  if (e && e > best) best = e;
                }
          trend.push(Math.round(best * 10) / 10);
        }
        const all = FL.allSetsOf(item.ex.id, null);
        const e1 = FL.estimated1RM(top.weightKg, top.reps);
        keyExercises.push({
          name_zh: item.ex.nameZh, name_en: item.ex.nameEn, muscle_group: item.ex.muscleGroup,
          movement_pattern: item.ex.movementPattern, is_unilateral: item.ex.isUnilateral,
          top_set: { weight_kg: top.weightKg, reps: top.reps },
          estimated_1rm_kg: e1 != null ? Math.round(e1 * 10) / 10 : null,
          weekly_best_e1rm_kg: trend,
          all_time_max_weight_kg: Math.round((FL.maxWeight(all) || 0) * 10) / 10,
          all_time_best_e1rm_kg: Math.round((FL.bestE1RM(all) || 0) * 10) / 10,
        });
      }
    }

    const t = { vol: [], cnt: [], dur: [] };
    for (let i = span - 1; i >= 0; i--) {
      const ref = new Date(refDate); ref.setDate(ref.getDate() - i * 7);
      const list = FL.workoutsInWeek(ref);
      t.vol.push(Math.round(list.reduce((a, w) => a + FL.volumeOf(w), 0)));
      t.cnt.push(list.length);
      t.dur.push(Math.round(list.reduce((a, w) => a + (new Date(w.endTime) - new Date(w.startTime)), 0) / 60000));
    }

    return {
      schema_version: 2, week_start: isoDate(ws),
      user_summary: { preferred_unit: FL.db.settings.unit, training_age_weeks: FL.trainingAgeWeeks() },
      weekly_summary: {
        workout_count: weekW.length,
        total_duration_min: t.dur[t.dur.length - 1], total_volume_kg: t.vol[t.vol.length - 1],
      },
      workouts: weekW.map((w) => ({
        date: isoDate(new Date(w.startTime)),
        duration_min: Math.round((new Date(w.endTime) - new Date(w.startTime)) / 60000),
        muscle_groups: [...new Set(w.entries.map((en) => FL.exerciseById(en.exerciseId)?.muscleGroup).filter(Boolean))],
        volume_kg: Math.round(FL.volumeOf(w)),
        feedback: w.feedback || null,
      })),
      muscle_group_summary: Object.entries(groupAgg).map(([g, a]) => ({
        group: g, sets: a.sets, volume_kg: Math.round(a.vol),
        volume_change_pct: prevDist[g] ? Math.round(((a.vol - prevDist[g]) / prevDist[g]) * 1000) / 10 : null,
        days_trained: [...a.days].sort((x, y) => x - y),
      })),
      movement_balance: {
        push_volume_kg: Math.round(bal.push), pull_volume_kg: Math.round(bal.pull),
        squat_volume_kg: Math.round(bal.squat), hinge_volume_kg: Math.round(bal.hinge),
      },
      key_exercises: keyExercises,
      trend_weeks: { weeks_included: span, weekly_volume_kg: t.vol, weekly_workout_count: t.cnt, weekly_duration_min: t.dur },
    };
  }

  const REPORT_SYSTEM = `你是一位資深肌力與體能教練（Strength & Conditioning Coach），為長期訓練者分析每週訓練資料。

規則：
1. 全部繁體中文（台灣用語）；健身術語用「中文（English）」格式。
2. 只根據提供的資料下結論；資料不足要明說「資料不足」，不得編造數字。組間休息一律假設 90 秒。
3. 肌群為單一分類制——複合動作的間接刺激請自行納入恢復分析考量。單邊動作的 Volume 已以總次數計；所有 weight_kg 都是總外部重量，雙手獨立持重動作已合併兩手重量。
4. 建議具體可執行（含重量/組數/頻率），最多 4 條。
5. 善用長期資料：trend_weeks 是最多 12 週逐週彙總（由舊到新）、key_exercises.weekly_best_e1rm_kg 是逐週最佳估算 1RM（0=該週未練）、all_time_* 是歷史最佳。明確判斷長期趨勢（持續進步/平台期(連 3 週以上無提升)/倒退），引用具體數字與週數；本週對照歷史最佳評價。
6. 找出弱點（weak_point）：訓練不足的肌群或動作模式、或明顯停滯的動作。
7. 語氣：專業、直接、鼓勵但不浮誇。`;

  const REPORT_SCHEMA = {
    type: "object", additionalProperties: false,
    required: ["headline", "volume_analysis", "recovery_analysis", "balance_analysis", "strength_progress", "weak_point", "suggestions"],
    properties: {
      headline: { type: "string", description: "一句話總結本週" },
      volume_analysis: {
        type: "object", additionalProperties: false,
        required: ["trend", "summary", "increased_groups", "decreased_groups"],
        properties: {
          trend: { type: "string", enum: ["increasing", "stable", "decreasing"] },
          summary: { type: "string" },
          increased_groups: { type: "array", items: { type: "string" } },
          decreased_groups: { type: "array", items: { type: "string" } },
        },
      },
      recovery_analysis: {
        type: "object", additionalProperties: false, required: ["risk_level", "summary"],
        properties: { risk_level: { type: "string", enum: ["good", "caution", "warning"] }, summary: { type: "string" } },
      },
      balance_analysis: {
        type: "object", additionalProperties: false, required: ["push_pull_ratio", "summary"],
        properties: { push_pull_ratio: { type: "number" }, summary: { type: "string" } },
      },
      strength_progress: {
        type: "object", additionalProperties: false,
        required: ["progressing_exercises", "plateaued_exercises", "summary"],
        properties: {
          progressing_exercises: { type: "array", items: { type: "string" } },
          plateaued_exercises: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
      },
      weak_point: {
        type: "object", additionalProperties: false, required: ["title", "summary"],
        properties: { title: { type: "string" }, summary: { type: "string" } },
      },
      suggestions: {
        type: "array", description: "下週建議，最多 4 條",
        items: {
          type: "object", additionalProperties: false, required: ["category", "title", "detail"],
          properties: {
            category: { type: "string", enum: ["training", "recovery", "exercise_swap", "balance"] },
            title: { type: "string" }, detail: { type: "string" },
          },
        },
      },
    },
  };

  async function generateWeeklyReport(refDate) {
    const payload = buildWeeklyPayload(refDate);
    if (!payload.weekly_summary.workout_count) throw new Error("這一週沒有訓練紀錄，無法分析。");
    const user = `以下是 ${payload.week_start} 起始週的訓練資料：\n${JSON.stringify(payload)}`;
    const res = await structured(REPORT_SYSTEM, user, REPORT_SCHEMA);
    return { weekStart: payload.week_start, content: res.content, usage: res.usage, provider: res.provider, model: res.model };
  }

  Object.assign(FL, {
    CLAUDE_MODELS, OPENAI_MODELS, AI_PROVIDERS, testKey, structured,
    updatePreferenceProfile, availableEquipment, candidateExercises, recentContext,
    generatePlan, buildWeeklyPayload, generateWeeklyReport,
    selectedProvider, selectedModel,
    hasApiKey: () => {
      const requested = FL.db.settings.aiProvider || "auto";
      if (requested === "openai") return !!openAIKey();
      if (requested === "anthropic") return !!anthropicKey();
      return !!openAIKey() || !!anthropicKey();
    },
    aiModelLabel: (id) => OPENAI_MODELS[id]?.short || CLAUDE_MODELS[id]?.short || id || "Auto",
  });
})(window.FL);
