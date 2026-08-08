import assert from "node:assert/strict";

const memory = new Map();
globalThis.window = {};
globalThis.localStorage = {
  getItem: (key) => memory.has(key) ? memory.get(key) : null,
  setItem: (key, value) => memory.set(key, String(value)),
};

await import("../js/data.js");
const FL = window.FL;
const legacy = {
  schemaVersion: 2,
  exercises: [
    { id: "keep-me", nameZh: "臥推", nameEn: "Bench Press", muscleGroup: "chest", movementPattern: "push" },
    { id: "db-fly", nameZh: "啞鈴飛鳥", nameEn: "Dumbbell Fly", muscleGroup: "chest", movementPattern: "push", equipment: "dumbbell", isCustom: false },
    { id: "single-row", nameZh: "單手啞鈴划船", nameEn: "Single Arm Dumbbell Row", muscleGroup: "back", movementPattern: "pull", equipment: "dumbbell", isCustom: false, isUnilateral: true },
  ],
  workouts: [{
    id: "workout-1", startTime: "2026-01-01T00:00:00.000Z", endTime: "2026-01-01T01:00:00.000Z",
    entries: [
      { id: "entry-fly", exerciseId: "db-fly", sets: [{ id: "set-fly", weightKg: 10, reps: 10, setType: "working", completedAt: "2026-01-01T00:10:00.000Z" }] },
      { id: "entry-row", exerciseId: "single-row", sets: [{ id: "set-row", weightKg: 10, reps: 10, setType: "working", completedAt: "2026-01-01T00:20:00.000Z" }] },
    ],
  }],
  reports: [], plans: [], settings: { unit: "kg", apiKey: "legacy-secret" },
};
memory.set("fitlog.v1", JSON.stringify(legacy));
const migrated = FL.loadDB();
assert.equal(migrated.schemaVersion, 5);
assert.equal(migrated.workouts[0].id, "workout-1");
assert.equal(migrated.exercises.find((x) => x.nameEn === "Bench Press").id, "keep-me");
assert.deepEqual(migrated.bodyRecords, []);
assert.equal(migrated.settings.aiProvider, "auto");
assert.equal(migrated.settings.anthropicApiKey, "legacy-secret");
const migratedFly = migrated.exercises.find((x) => x.id === "db-fly");
assert.equal(migratedFly.weightInputMode, "perSide");
assert.equal(migrated.workouts[0].entries[0].sets[0].weightKg, 20);
assert.equal(migrated.workouts[0].entries[1].sets[0].weightKg, 10);
assert.equal(FL.inputWeightKg(20, migratedFly), 10);
assert.equal(FL.totalWeightKg(10, migratedFly), 20);
FL.migrate(migrated);
assert.equal(migrated.workouts[0].entries[0].sets[0].weightKg, 20);
migrated.settings.openaiApiKey = "openai-secret";
const exported = FL.exportData();
assert.equal(exported.settings.apiKey, undefined);
assert.equal(exported.settings.openaiApiKey, undefined);
assert.equal(exported.settings.anthropicApiKey, undefined);
assert.equal(exported.settings.aiGatewayToken, undefined);

await import("../js/stats.js");
assert.equal(FL.entryVolume(migrated.workouts[0].entries[0]), 200);
assert.equal(FL.entryVolume(migrated.workouts[0].entries[1]), 200);
await import("../js/ai.js");
assert.equal(FL.selectedProvider(), "openai");
assert.equal(FL.selectedModel("openai", "vision"), "gpt-5.6-terra");

globalThis.fetch = async (url, options) => {
  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.equal(options.headers.authorization, "Bearer openai-secret");
  const body = JSON.parse(options.body);
  assert.equal(body.model, "gpt-5.6-luna");
  if (body.text) assert.equal(body.text.format.type, "json_schema");
  return new Response(JSON.stringify({
    model: body.model,
    output: [{ type: "message", content: [{ type: "output_text", text: body.text ? '{"answer":"ok"}' : "OK" }] }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200, headers: { "content-type": "application/json" } });
};
assert.equal((await FL.testKey()).provider, "openai");
const tinySchema = { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } };
assert.equal((await FL.structured("system", "input", tinySchema)).content.answer, "ok");

FL.ui = {};
await import("../js/body.js");
const sanitizedBody = FL.sanitizeBodyRecord({
  weightKg: 680, skeletalMuscleKg: 36.2, bodyFatPct: 160, visceralFatAreaCm2: 92,
  segmentalLean: {
    leftArm: { massKg: 3.1, sufficiencyPct: 104 }, rightArm: { massKg: 88, sufficiencyPct: 101 },
    trunk: { massKg: 27.4, sufficiencyPct: 800 }, leftLeg: { massKg: 9.2, sufficiencyPct: 98 },
  },
});
assert.equal(sanitizedBody.weightKg, null);
assert.equal(sanitizedBody.skeletalMuscleKg, 36.2);
assert.equal(sanitizedBody.bodyFatPct, null);
assert.equal(sanitizedBody.visceralFatAreaCm2, 92);
assert.equal(sanitizedBody.segmentalLean.leftArm.massKg, 3.1);
assert.equal(sanitizedBody.segmentalLean.rightArm.massKg, null);
assert.equal(sanitizedBody.segmentalLean.trunk.sufficiencyPct, null);

migrated.settings.aiProvider = "anthropic";
globalThis.fetch = async (url, options) => {
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(options.headers["x-api-key"], "legacy-secret");
  assert.equal(options.headers["anthropic-dangerous-direct-browser-access"], "true");
  const body = JSON.parse(options.body);
  return new Response(JSON.stringify({
    model: "claude-sonnet-5", content: [{ type: "text", text: body.output_config ? '{"answer":"ok"}' : "OK" }], usage: {},
  }), { status: 200, headers: { "content-type": "application/json" } });
};
assert.equal((await FL.testKey()).provider, "anthropic");
assert.equal((await FL.structured("system", "input", tinySchema)).content.answer, "ok");

const worker = (await import("../serverless/worker.js")).default;
const missingConfig = await worker.fetch(new Request("https://gateway.test/", { method: "POST" }), {});
assert.equal(missingConfig.status, 503);
const unauthorized = await worker.fetch(new Request("https://gateway.test/", { method: "POST" }), { GATEWAY_TOKEN: "secret" });
assert.equal(unauthorized.status, 401);

console.log("FitLog v3.7 smoke tests passed");
