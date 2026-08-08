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
  exercises: [{ id: "keep-me", nameZh: "臥推", nameEn: "Bench Press", muscleGroup: "chest", movementPattern: "push" }],
  workouts: [{ id: "workout-1", startTime: "2026-01-01T00:00:00.000Z", endTime: "2026-01-01T01:00:00.000Z", entries: [] }],
  reports: [], plans: [], settings: { unit: "kg", apiKey: "legacy-secret" },
};
memory.set("fitlog.v1", JSON.stringify(legacy));
const migrated = FL.loadDB();
assert.equal(migrated.schemaVersion, 3);
assert.equal(migrated.workouts[0].id, "workout-1");
assert.equal(migrated.exercises.find((x) => x.nameEn === "Bench Press").id, "keep-me");
assert.deepEqual(migrated.bodyRecords, []);
assert.equal(migrated.settings.aiProvider, "auto");
migrated.settings.aiGatewayToken = "gateway-secret";
const exported = FL.exportData();
assert.equal(exported.settings.apiKey, undefined);
assert.equal(exported.settings.aiGatewayToken, undefined);

await import("../js/stats.js");
await import("../js/ai.js");
assert.equal(FL.selectedProvider("vision"), "auto");
assert.equal(FL.selectedModel("openai", "vision"), "gpt-5.6-terra");

const worker = (await import("../serverless/worker.js")).default;
const missingConfig = await worker.fetch(new Request("https://gateway.test/", { method: "POST" }), {});
assert.equal(missingConfig.status, 503);
const unauthorized = await worker.fetch(new Request("https://gateway.test/", { method: "POST" }), { GATEWAY_TOKEN: "secret" });
assert.equal(unauthorized.status, 401);

console.log("FitLog v3 smoke tests passed");
