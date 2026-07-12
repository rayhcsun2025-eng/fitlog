/* =====================================================================
   FitLog v2 — 資料層（Data Layer）
   schemaVersion + migrate()（向後相容）、動作庫（合併/別名/器材/單邊）、
   enum、單位換算、格式化。所有寫入經 save()。
   全域命名空間 window.FL。
   ===================================================================== */
"use strict";
window.FL = window.FL || {};

(function (FL) {
  const STORAGE_KEY = "fitlog.v1"; // 沿用同一鍵 → 就地升級、零遷移風險
  const SCHEMA_VERSION = 2;
  const LB_PER_KG = 2.2046226218;

  // ---- 常數表 ----
  const MUSCLE_GROUPS = {
    chest:    { zh: "胸",   en: "Chest",    color: "#e07a6a" },
    back:     { zh: "背",   en: "Back",     color: "#6aa7d8" },
    shoulder: { zh: "肩",   en: "Shoulder", color: "#e0b46a" },
    leg:      { zh: "腿",   en: "Leg",      color: "#a98fd6" },
    arm:      { zh: "手臂", en: "Arm",      color: "#6ac8b8" },
    core:     { zh: "核心", en: "Core",     color: "#d68fbf" },
    cardio:   { zh: "有氧", en: "Cardio",   color: "#8fc86a" },
  };
  const PATTERNS = {
    push: "推（Push）", pull: "拉（Pull）", squat: "膝主導（Squat）",
    hinge: "髖主導（Hinge）", core: "核心（Core）", cardio: "有氧（Cardio）",
  };
  const EQUIPMENT = {
    barbell: "槓鈴（Barbell）", dumbbell: "啞鈴（Dumbbell）",
    cable: "滑輪／繩索（Cable）", machine: "機械（Machine）",
    bodyweight: "自重（Bodyweight）", kettlebell: "壺鈴（Kettlebell）",
  };
  const SET_TYPES = ["working", "warmup", "failure"];
  const GOALS = {
    strength: "力量（Strength）", hypertrophy: "肌肥大（Hypertrophy）",
    fatloss: "減脂（Fat Loss）", endurance: "耐力（Endurance）",
    maintenance: "維持（Maintenance）", recovery: "恢復（Recovery）",
  };
  const BODY_STATES = { great: "很好", normal: "普通", tired: "疲勞", sore: "痠痛" };
  const FEEDBACK = {
    easy: { label: "很輕鬆", rpe: "≈RPE 6" },
    good: { label: "剛剛好", rpe: "≈RPE 7–8" },
    hard: { label: "有點吃力", rpe: "≈RPE 8–9" },
    veryhard: { label: "很吃力", rpe: "≈RPE 9–10" },
    failed: { label: "沒完成", rpe: "未完成" },
  };
  const PR_LABELS = {
    maxWeight: "最大重量（Max Weight）",
    estimated1RM: "估算 1RM（Estimated 1RM）",
    maxVolume: "最大單場量（Max Session Volume）",
    maxReps: "最多次數（Max Reps）",
  };

  // ---- 動作庫（v2 canonical）----
  // [nameZh, nameEn, group, pattern, bodyweight, equipment, unilateral]
  const SEED = [
    // 胸
    ["臥推","Bench Press","chest","push",0,"barbell",0],
    ["上斜臥推","Incline Bench Press","chest","push",0,"barbell",0],
    ["啞鈴臥推","Dumbbell Bench Press","chest","push",0,"dumbbell",0],
    ["啞鈴飛鳥","Dumbbell Fly","chest","push",0,"dumbbell",0],
    ["滑輪飛鳥","Cable Fly","chest","push",0,"cable",0],
    ["繩索夾胸","Cable Crossover","chest","push",0,"cable",0],
    ["伏地挺身","Push Up","chest","push",1,"bodyweight",0],
    ["雙槓撐體","Dip","chest","push",1,"bodyweight",0],
    ["胸推機","Chest Press Machine","chest","push",0,"machine",0],
    // 背
    ["硬舉","Deadlift","back","hinge",0,"barbell",0],
    ["引體向上","Pull Up","back","pull",1,"bodyweight",0],
    ["滑輪下拉","Lat Pulldown","back","pull",0,"cable",0],
    ["坐姿划船","Seated Cable Row","back","pull",0,"cable",0],
    ["槓鈴划船","Barbell Row","back","pull",0,"barbell",0],
    ["啞鈴划船","Dumbbell Row","back","pull",0,"dumbbell",0],
    ["單手啞鈴划船","Single Arm Dumbbell Row","back","pull",0,"dumbbell",1],
    ["胸靠划船","Chest Supported Row","back","pull",0,"machine",0],
    ["T 槓划船","T-Bar Row","back","pull",0,"barbell",0],
    ["直臂下拉","Straight-Arm Pulldown","back","pull",0,"cable",0],
    // 肩
    ["槓鈴肩推","Overhead Press","shoulder","push",0,"barbell",0],
    ["啞鈴肩推","Dumbbell Shoulder Press","shoulder","push",0,"dumbbell",0],
    ["阿諾肩推","Arnold Press","shoulder","push",0,"dumbbell",0],
    ["側平舉","Lateral Raise","shoulder","push",0,"dumbbell",0],
    ["前平舉","Front Raise","shoulder","push",0,"dumbbell",0],
    ["後三角飛鳥","Rear Delt Fly","shoulder","pull",0,"dumbbell",0],
    ["面拉","Face Pull","shoulder","pull",0,"cable",0],
    // 腿
    ["深蹲","Squat","leg","squat",0,"barbell",0],
    ["前蹲","Front Squat","leg","squat",0,"barbell",0],
    ["腿推","Leg Press","leg","squat",0,"machine",0],
    ["羅馬尼亞硬舉","Romanian Deadlift","leg","hinge",0,"barbell",0],
    ["保加利亞分腿蹲","Bulgarian Split Squat","leg","squat",0,"dumbbell",1],
    ["弓步蹲","Lunge","leg","squat",0,"dumbbell",1],
    ["臀推","Hip Thrust","leg","hinge",0,"barbell",0],
    ["腿後勾","Leg Curl","leg","hinge",0,"machine",0],
    ["腿前伸","Leg Extension","leg","squat",0,"machine",0],
    ["站姿提踵","Standing Calf Raise","leg","squat",0,"machine",0],
    // 手臂
    ["槓鈴彎舉","Barbell Curl","arm","pull",0,"barbell",0],
    ["啞鈴彎舉","Dumbbell Curl","arm","pull",0,"dumbbell",0],
    ["錘式彎舉","Hammer Curl","arm","pull",0,"dumbbell",0],
    ["繩索下壓","Triceps Pushdown","arm","push",0,"cable",0],
    ["仰臥三頭伸展","Skull Crusher","arm","push",0,"barbell",0],
    ["窄握臥推","Close-Grip Bench Press","arm","push",0,"barbell",0],
    ["過頭三頭伸展","Overhead Triceps Extension","arm","push",0,"dumbbell",0],
    // 核心
    ["棒式","Plank","core","core",1,"bodyweight",0],
    ["側棒式","Side Plank","core","core",1,"bodyweight",1],
    ["Dead Bug","Dead Bug","core","core",1,"bodyweight",0],
    ["Bird Dog","Bird Dog","core","core",1,"bodyweight",0],
    ["懸垂舉腿","Hanging Leg Raise","core","core",1,"bodyweight",0],
    ["捲腹","Crunch","core","core",1,"bodyweight",0],
    ["俄羅斯轉體","Russian Twist","core","core",1,"bodyweight",0],
    ["腹輪","Ab Wheel Rollout","core","core",1,"bodyweight",0],
    ["繩索捲腹","Cable Crunch","core","core",0,"cable",0],
  ];

  // 舊 nameEn → v2 nameEn（同一動作、不同命名；用來保留既有 id 不斷連歷史）
  const ALIAS = {
    "One-Arm Dumbbell Row": "Single Arm Dumbbell Row",
    "Cable Row": "Seated Cable Row",
    "Reverse Fly": "Rear Delt Fly",
    // Overhead Press 維持原名（v2 seed 已沿用同名，不需別名）
  };

  function seedExercise(row, id) {
    const [nameZh, nameEn, muscleGroup, movementPattern, bw, equipment, uni] = row;
    return {
      id: id || uid(), nameZh, nameEn, muscleGroup, movementPattern,
      isBodyweight: !!bw, equipment, isUnilateral: !!uni,
      isCustom: false, isFavorite: false, isBlacklisted: false, isArchived: false,
    };
  }

  // ---- Store ----
  let db = null;

  function loadDB() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) {}
    if (!data) {
      data = { schemaVersion: SCHEMA_VERSION, exercises: [], workouts: [], reports: [], plans: [], settings: {} };
      data.exercises = SEED.map((r) => seedExercise(r));
    }
    data = migrate(data);
    db = data;
    return db;
  }

  /* 遷移：逐級升版，只補值/合併、永不刪除既有欄位 */
  function migrate(data) {
    data.exercises = data.exercises || [];
    data.workouts = data.workouts || [];
    data.reports = data.reports || [];
    data.plans = data.plans || [];
    data.settings = data.settings || {};
    const from = data.schemaVersion || 1;

    if (from < 2) {
      // 1) 動作庫合併：以 nameEn（含別名）比對現有、保留 id、補 v2 欄位；新動作加入
      const byName = {};
      for (const ex of data.exercises) {
        const canonical = ALIAS[ex.nameEn] || ex.nameEn;
        byName[canonical] = ex;
      }
      for (const row of SEED) {
        const [, nameEn] = row;
        const existing = byName[nameEn];
        if (existing) {
          // 保留 id 與 isCustom/isArchived；補 v2 欄位、對齊器材與單邊旗標
          const s = seedExercise(row, existing.id);
          existing.nameZh = existing.isCustom ? existing.nameZh : s.nameZh;
          existing.nameEn = nameEn;
          existing.muscleGroup = existing.isCustom ? existing.muscleGroup : s.muscleGroup;
          existing.movementPattern = existing.isCustom ? existing.movementPattern : s.movementPattern;
          existing.equipment = existing.equipment || s.equipment;
          existing.isBodyweight = existing.isBodyweight ?? s.isBodyweight;
          existing.isUnilateral = existing.isUnilateral ?? s.isUnilateral;
          if (existing.isUnilateral === undefined) existing.isUnilateral = s.isUnilateral;
          // 單邊旗標：seed 說是單邊就標記（回溯套用，已與使用者確認）
          if (s.isUnilateral) existing.isUnilateral = true;
          existing.isFavorite = existing.isFavorite || false;
          existing.isBlacklisted = existing.isBlacklisted || false;
        } else {
          data.exercises.push(seedExercise(row));
        }
      }
      // 舊資料殘留、v2 沒有的動作 → 保留、補齊新欄位（不刪除）
      for (const ex of data.exercises) {
        if (ex.equipment === undefined) ex.equipment = ex.isBodyweight ? "bodyweight" : "barbell";
        if (ex.isUnilateral === undefined) ex.isUnilateral = false;
        if (ex.isFavorite === undefined) ex.isFavorite = false;
        if (ex.isBlacklisted === undefined) ex.isBlacklisted = false;
      }
      // 2) workouts：補 feedback
      for (const w of data.workouts) if (w.feedback === undefined) w.feedback = null;
      // 3) settings：補預設；apiKey 保留在 storage
      data.settings.defaultGoal = data.settings.defaultGoal || "hypertrophy";
      data.settings.equipmentProfile = data.settings.equipmentProfile ||
        { barbell: true, dumbbell: true, cable: true, machine: true, bodyweight: true, kettlebell: false };
      data.settings.preferenceProfile = data.settings.preferenceProfile || {};
    }

    data.settings = Object.assign(
      { unit: "kg", restSeconds: 90, apiKey: "", model: "claude-sonnet-5", defaultGoal: "hypertrophy" },
      data.settings
    );
    data.schemaVersion = SCHEMA_VERSION;
    return data;
  }

  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
  function exerciseById(id) { return db.exercises.find((e) => e.id === id); }

  // 匯出時排除 API Key（安全）
  function exportData() {
    const clone = JSON.parse(JSON.stringify(db));
    if (clone.settings) delete clone.settings.apiKey;
    return clone;
  }

  // ---- 單位換算（canonical kg）----
  function toDisplay(kg) {
    return db.settings.unit === "kg" ? Math.round(kg / 0.25) * 0.25 : Math.round((kg * LB_PER_KG) / 0.5) * 0.5;
  }
  function toKg(value) { return db.settings.unit === "kg" ? value : value / LB_PER_KG; }
  function trimNum(v) { return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100); }
  function fmtWeight(kg) { return `${trimNum(toDisplay(kg))} ${db.settings.unit}`; }
  function fmtVolume(kg) {
    if (db.settings.unit === "lb") return `${Math.round(kg * LB_PER_KG).toLocaleString()} lb`;
    return kg >= 10000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg).toLocaleString()} kg`;
  }
  function fmtDuration(ms) {
    const min = Math.floor(ms / 60000), h = Math.floor(min / 60), m = min % 60;
    return h > 0 ? (m > 0 ? `${h} 小時 ${m} 分` : `${h} 小時`) : `${m} 分`;
  }
  function fmtClock(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const mm = String(m).padStart(h > 0 ? 2 : 1, "0"), ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" });
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // 匯入還原（整包取代），重掛 db 參照
  function replaceDB(newData) {
    db = migrate(newData);
    save();
    return db;
  }

  // ---- 匯出到命名空間 ----
  Object.assign(FL, {
    STORAGE_KEY, SCHEMA_VERSION, LB_PER_KG,
    MUSCLE_GROUPS, PATTERNS, EQUIPMENT, SET_TYPES, GOALS, BODY_STATES, FEEDBACK, PR_LABELS, SEED,
    loadDB, migrate, save, uid, exerciseById, exportData, replaceDB,
    toDisplay, toKg, trimNum, fmtWeight, fmtVolume, fmtDuration, fmtClock, fmtDate, esc,
  });
  Object.defineProperty(FL, "db", { get() { return db; }, configurable: true });
})(window.FL);
