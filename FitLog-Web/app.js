/* =====================================================================
   FitLog Web — 個人健身紀錄（純前端 PWA，資料存 localStorage）
   資料模型與計算邏輯對齊 iOS 版（canonical kg、PR 即時計算、週一起始週）
   ===================================================================== */
"use strict";

/* ===== 常數 ===== */
const STORAGE_KEY = "fitlog.v1";
const LB_PER_KG = 2.2046226218;
const MAX_REPS_1RM = 12;

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
const SET_TYPES = ["working", "warmup", "failure"];
const PR_LABELS = {
  maxWeight: "最大重量（Max Weight）",
  estimated1RM: "估算 1RM（Estimated 1RM）",
  repPR: "次數紀錄（Rep PR）",
};

const SEED = [
  ["臥推","Bench Press","chest","push",0],["上斜臥推","Incline Bench Press","chest","push",0],
  ["啞鈴臥推","Dumbbell Bench Press","chest","push",0],["啞鈴飛鳥","Dumbbell Fly","chest","push",0],
  ["繩索夾胸","Cable Crossover","chest","push",0],["伏地挺身","Push Up","chest","push",1],
  ["雙槓撐體","Dip","chest","push",1],["胸推機","Chest Press Machine","chest","push",0],
  ["硬舉","Deadlift","back","hinge",0],["引體向上","Pull Up","back","pull",1],
  ["滑輪下拉","Lat Pulldown","back","pull",0],["坐姿划船","Cable Row","back","pull",0],
  ["槓鈴划船","Barbell Row","back","pull",0],["啞鈴單臂划船","One-Arm Dumbbell Row","back","pull",0],
  ["T 槓划船","T-Bar Row","back","pull",0],["直臂下拉","Straight-Arm Pulldown","back","pull",0],
  ["槓鈴肩推","Overhead Press","shoulder","push",0],["啞鈴肩推","Dumbbell Shoulder Press","shoulder","push",0],
  ["阿諾肩推","Arnold Press","shoulder","push",0],["側平舉","Lateral Raise","shoulder","push",0],
  ["前平舉","Front Raise","shoulder","push",0],["反向飛鳥","Reverse Fly","shoulder","pull",0],
  ["面拉","Face Pull","shoulder","pull",0],
  ["深蹲","Squat","leg","squat",0],["前蹲","Front Squat","leg","squat",0],
  ["腿推","Leg Press","leg","squat",0],["羅馬尼亞硬舉","Romanian Deadlift","leg","hinge",0],
  ["保加利亞分腿蹲","Bulgarian Split Squat","leg","squat",0],["弓步蹲","Lunge","leg","squat",0],
  ["腿彎舉","Leg Curl","leg","hinge",0],["腿伸展","Leg Extension","leg","squat",0],
  ["臀推","Hip Thrust","leg","hinge",0],["站姿提踵","Standing Calf Raise","leg","squat",0],
  ["槓鈴彎舉","Barbell Curl","arm","pull",0],["啞鈴彎舉","Dumbbell Curl","arm","pull",0],
  ["錘式彎舉","Hammer Curl","arm","pull",0],["繩索下壓","Triceps Pushdown","arm","push",0],
  ["仰臥三頭伸展","Skull Crusher","arm","push",0],["窄握臥推","Close-Grip Bench Press","arm","push",0],
  ["過頭三頭伸展","Overhead Triceps Extension","arm","push",0],
  ["平板支撐","Plank","core","core",1],["捲腹","Crunch","core","core",1],
  ["懸垂舉腿","Hanging Leg Raise","core","core",1],["俄羅斯轉體","Russian Twist","core","core",1],
  ["腹輪","Ab Wheel Rollout","core","core",1],["繩索捲腹","Cable Crunch","core","core",0],
];

/* ===== Store ===== */
let db = loadDB();

function loadDB() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) {}
  if (!data) data = { exercises: [], workouts: [], settings: {} };
  data.settings = Object.assign(
    { unit: "kg", restSeconds: 90, apiKey: "", model: "claude-sonnet-5" },
    data.settings
  );
  if (!data.reports) data.reports = [];
  if (!data.exercises.length) {
    data.exercises = SEED.map(([zh, en, group, pattern, bw]) => ({
      id: uid(), nameZh: zh, nameEn: en, muscleGroup: group, movementPattern: pattern,
      isBodyweight: !!bw, isCustom: false, isArchived: false,
    }));
  }
  return data;
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(); }
function exerciseById(id) { return db.exercises.find((e) => e.id === id); }

/* ===== 單位換算（canonical kg） ===== */
function toDisplay(kg) {
  return db.settings.unit === "kg" ? Math.round(kg / 0.25) * 0.25 : Math.round((kg * LB_PER_KG) / 0.5) * 0.5;
}
function toKg(value) {
  return db.settings.unit === "kg" ? value : value / LB_PER_KG;
}
function trimNum(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}
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

/* ===== PR 計算（即時、不落地） ===== */
function epley(kg, reps) {
  if (reps < 1 || reps > MAX_REPS_1RM || kg <= 0) return null;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}
function scoringSets(sets) { return sets.filter((s) => s.completedAt && s.setType !== "warmup"); }
function maxWeight(sets) {
  const w = scoringSets(sets).map((s) => s.weightKg).filter((v) => v > 0);
  return w.length ? Math.max(...w) : null;
}
function bestE1RM(sets) {
  const v = scoringSets(sets).map((s) => epley(s.weightKg, s.reps)).filter((x) => x != null);
  return v.length ? Math.max(...v) : null;
}
function repPRs(sets) {
  const map = {};
  for (const s of scoringSets(sets)) {
    if (s.reps >= 1 && s.reps <= MAX_REPS_1RM && s.weightKg > 0)
      map[s.reps] = Math.max(map[s.reps] || 0, s.weightKg);
  }
  return map;
}
function prKind(set, history) {
  if (set.setType === "warmup" || set.weightKg <= 0 || set.reps <= 0) return null;
  const scoring = scoringSets(history);
  if (!scoring.length) return null; // 第一次做的動作不算 PR
  if (set.weightKg > (maxWeight(scoring) || 0)) return "maxWeight";
  const e = epley(set.weightKg, set.reps);
  if (e != null && e > (bestE1RM(scoring) || 0)) return "estimated1RM";
  if (set.reps <= MAX_REPS_1RM && set.weightKg > (repPRs(scoring)[set.reps] || 0)) return "repPR";
  return null;
}
function allSetsOf(exerciseId, excludeSetId) {
  const out = [];
  for (const w of db.workouts)
    for (const en of w.entries)
      if (en.exerciseId === exerciseId)
        for (const s of en.sets)
          if (s.id !== excludeSetId) out.push(s);
  return out;
}

/* ===== 統計（週一起始週） ===== */
function weekStartOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function volumeOf(workout) {
  let v = 0;
  for (const en of workout.entries)
    for (const s of en.sets)
      if (s.completedAt && s.setType !== "warmup") v += s.weightKg * s.reps;
  return v;
}
function completedWorkouts() { return db.workouts.filter((w) => w.endTime); }
function workoutsInWeek(refDate) {
  const start = weekStartOf(refDate), end = new Date(start.getTime() + 7 * 86400000);
  return completedWorkouts().filter((w) => {
    const t = new Date(w.startTime);
    return t >= start && t < end;
  });
}
function muscleDistribution(workouts) {
  const totals = {};
  for (const w of workouts)
    for (const en of w.entries) {
      const ex = exerciseById(en.exerciseId);
      if (!ex) continue;
      let v = 0;
      for (const s of en.sets) if (s.completedAt && s.setType !== "warmup") v += s.weightKg * s.reps;
      totals[ex.muscleGroup] = (totals[ex.muscleGroup] || 0) + v;
    }
  return Object.entries(totals).filter(([, v]) => v > 0)
    .map(([group, volumeKg]) => ({ group, volumeKg }))
    .sort((a, b) => b.volumeKg - a.volumeKg);
}
function sessionHistory(exerciseId) {
  const sessions = [];
  for (const w of completedWorkouts())
    for (const en of w.entries) {
      if (en.exerciseId !== exerciseId) continue;
      const sets = en.sets.filter((s) => s.completedAt);
      if (sets.length) sessions.push({ date: w.startTime, sets });
    }
  return sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
}
function lastPerformance(exerciseId, excludeWorkoutId) {
  const list = db.workouts
    .filter((w) => w.id !== excludeWorkoutId)
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  for (const w of list)
    for (const en of w.entries) {
      if (en.exerciseId !== exerciseId) continue;
      const done = en.sets.filter((s) => s.completedAt);
      if (done.length) return done;
    }
  return null;
}

/* ===== 訓練操作 ===== */
function activeWorkout() { return db.workouts.find((w) => !w.endTime) || null; }

function startWorkout() {
  let w = activeWorkout();
  if (!w) {
    w = { id: uid(), startTime: new Date().toISOString(), endTime: null, note: "", entries: [] };
    db.workouts.push(w);
    save();
  }
  return w;
}
function addExerciseToWorkout(workout, exercise) {
  const entry = { id: uid(), exerciseId: exercise.id, sets: [] };
  const last = lastPerformance(exercise.id, workout.id);
  if (last) {
    for (const p of last)
      entry.sets.push({ id: uid(), weightKg: p.weightKg, reps: p.reps, setType: p.setType, completedAt: null, restSec: null });
  } else {
    entry.sets.push({ id: uid(), weightKg: 0, reps: 0, setType: "working", completedAt: null, restSec: null });
  }
  workout.entries.push(entry);
  save();
}
function addSet(entry) {
  const last = entry.sets[entry.sets.length - 1];
  entry.sets.push({
    id: uid(), weightKg: last ? last.weightKg : 0, reps: last ? last.reps : 0,
    setType: last ? last.setType : "working", completedAt: null, restSec: null,
  });
  save();
}
function completeSet(workout, set) {
  const now = new Date();
  set.completedAt = now.toISOString();
  const previous = workout.entries.flatMap((e) => e.sets)
    .map((s) => s.completedAt).filter((t) => t && t < set.completedAt).sort().pop();
  if (previous) set.restSec = Math.round((now - new Date(previous)) / 1000);
  const ex = findEntryOf(workout, set);
  let kind = null;
  if (ex) kind = prKind(set, allSetsOf(ex.exerciseId, set.id));
  save();
  return kind;
}
function findEntryOf(workout, set) {
  return workout.entries.find((e) => e.sets.some((s) => s.id === set.id));
}
function finishWorkout(workout) {
  for (const en of workout.entries) en.sets = en.sets.filter((s) => s.completedAt);
  workout.entries = workout.entries.filter((en) => en.sets.length);
  workout.endTime = new Date().toISOString();
  save();
}
function discardWorkout(workout) {
  db.workouts = db.workouts.filter((w) => w.id !== workout.id);
  save();
}

/* ===== 休息計時器（Date 差值，不漂移） ===== */
const rest = { endAt: null, total: 0 };
function restRunning() { return rest.endAt && rest.endAt > Date.now(); }
function restRemaining() { return rest.endAt ? Math.max(0, Math.round((rest.endAt - Date.now()) / 1000)) : 0; }
function startRest(sec) {
  rest.endAt = Date.now() + sec * 1000;
  rest.total = sec;
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  renderRestBar();
}
function cancelRest() { rest.endAt = null; rest.total = 0; renderRestBar(); }
function restDone() {
  rest.endAt = null; rest.total = 0;
  beep();
  if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
  if ("Notification" in window && Notification.permission === "granted")
    new Notification("休息結束（Rest Over）", { body: "回去做下一組！" });
  renderRestBar();
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; gain.gain.value = 0.12;
    osc.start(); osc.stop(ctx.currentTime + 0.25);
  } catch (_) {}
}

/* =====================================================================
   UI
   ===================================================================== */
const $view = document.getElementById("view");
const $overlay = document.getElementById("overlay");
const $workoutOv = document.getElementById("workoutOverlay");
const $modal = document.getElementById("modal");
const $miniBar = document.getElementById("miniBar");
const $toast = document.getElementById("toast");
let currentTab = "dashboard";
let restBarWasRunning = null;

/* ----- Tabs ----- */
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    renderTab();
  });
});

function renderTab() {
  if (currentTab === "dashboard") renderDashboard();
  else if (currentTab === "workouts") renderWorkouts();
  else if (currentTab === "exercises") renderExercises();
  else renderSettings();
}

/* ----- 總覽 Dashboard ----- */
function renderDashboard() {
  const done = completedWorkouts();
  if (!done.length) {
    $view.innerHTML = `<h1 class="page-title">總覽</h1>
      <div class="empty"><span class="empty-icon">📊</span>還沒有資料<br>完成第一次訓練後，這裡會顯示你的週統計與趨勢。</div>`;
    return;
  }
  const now = new Date();
  const week = workoutsInWeek(now);
  const totalDur = week.reduce((a, w) => a + (new Date(w.endTime) - new Date(w.startTime)), 0);
  const totalVol = week.reduce((a, w) => a + volumeOf(w), 0);
  const dist4 = muscleDistribution(completedWorkouts().filter((w) => {
    const s = weekStartOf(now); s.setDate(s.getDate() - 21);
    return new Date(w.startTime) >= s;
  }));
  const topGroup = muscleDistribution(week)[0];

  // 近四週趨勢
  const trend = [];
  for (let i = 3; i >= 0; i--) {
    const ref = new Date(now); ref.setDate(ref.getDate() - i * 7);
    const ws = weekStartOf(ref);
    trend.push({ label: `${ws.getMonth() + 1}/${ws.getDate()}`, vol: workoutsInWeek(ref).reduce((a, w) => a + volumeOf(w), 0) });
  }
  const maxVol = Math.max(...trend.map((t) => t.vol), 1);
  const distTotal = dist4.reduce((a, d) => a + d.volumeKg, 0) || 1;

  $view.innerHTML = `
    <h1 class="page-title">總覽</h1>
    <h2 class="section-title" style="margin-top:0">本週</h2>
    <div class="stat-grid">
      <div class="card stat-card"><div class="stat-title">訓練次數（Frequency）</div><div class="stat-value">${week.length}</div><div class="stat-caption">次</div></div>
      <div class="card stat-card"><div class="stat-title">總訓練時間（Duration）</div><div class="stat-value" style="font-size:20px">${totalDur ? fmtDuration(totalDur) : "—"}</div></div>
      <div class="card stat-card"><div class="stat-title">總訓練量（Volume）</div><div class="stat-value" style="font-size:20px">${totalVol ? fmtVolume(totalVol) : "—"}</div></div>
      <div class="card stat-card"><div class="stat-title">最多肌群（Top Group）</div><div class="stat-value" style="font-size:20px">${topGroup ? MUSCLE_GROUPS[topGroup.group].zh : "—"}</div><div class="stat-caption">${topGroup ? MUSCLE_GROUPS[topGroup.group].en : ""}</div></div>
    </div>
    <h2 class="section-title">近四週</h2>
    <div class="card">
      <div class="stat-title" style="margin-bottom:10px">訓練量趨勢（Volume Trend）</div>
      <div class="bar-chart">
        ${trend.map((t) => `<div class="bar-col">
          <div class="bar-value">${t.vol ? fmtVolume(t.vol) : ""}</div>
          <div class="bar" style="height:${Math.max(2, (t.vol / maxVol) * 100)}%"></div>
          <div class="bar-label">${t.label}</div>
        </div>`).join("")}
      </div>
    </div>
    <div class="card">
      <div class="stat-title" style="margin-bottom:4px">肌群分布（Muscle Groups）· 近四週</div>
      ${dist4.length ? dist4.map((d) => `<div class="dist-row">
        <span class="dist-name">${MUSCLE_GROUPS[d.group].zh}</span>
        <div class="dist-track"><div class="dist-fill" style="width:${(d.volumeKg / distTotal) * 100}%;background:${MUSCLE_GROUPS[d.group].color}"></div></div>
        <span class="dist-pct">${Math.round((d.volumeKg / distTotal) * 100)}%</span>
      </div>`).join("") : `<div class="empty" style="padding:16px">尚無資料</div>`}
    </div>
    ${aiSectionHTML()}`;
  bindAiSection($view);
}

/* ----- 訓練 Tab ----- */
function renderWorkouts() {
  const done = completedWorkouts().sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  const active = activeWorkout();
  $view.innerHTML = `
    <h1 class="page-title">訓練</h1>
    <button class="btn ${active ? "btn-card" : "btn-primary"}" id="startBtn">${active ? "▲ 回到訓練" : "＋ 開始訓練（Workout）"}</button>
    <h2 class="section-title">歷史紀錄（History）</h2>
    ${done.length ? done.map((w) => {
      const groups = [...new Set(w.entries.map((en) => exerciseById(en.exerciseId)?.muscleGroup).filter(Boolean))];
      return `<button class="list-item" data-workout="${w.id}">
        <div class="li-top"><span class="li-title">${fmtDate(w.startTime)}</span>
          <span class="li-sub num">${fmtDuration(new Date(w.endTime) - new Date(w.startTime))}</span></div>
        <div class="li-row"><span class="li-sub num">${fmtVolume(volumeOf(w))}</span>
          <span>${groups.slice(0, 3).map((g) => `<span class="tag" style="color:${MUSCLE_GROUPS[g].color}">${MUSCLE_GROUPS[g].zh}</span>`).join(" ")}</span></div>
      </button>`;
    }).join("") : `<div class="empty"><span class="empty-icon">🏋️</span>還沒有訓練紀錄<br>點上方「開始訓練」記錄你的第一次。</div>`}`;

  document.getElementById("startBtn").onclick = () => { startWorkout(); openWorkoutOverlay(); };
  $view.querySelectorAll("[data-workout]").forEach((el) => {
    el.onclick = () => openWorkoutDetail(el.dataset.workout);
  });
}

/* ----- 訓練詳情（可編輯） ----- */
function openWorkoutDetail(id) {
  const w = db.workouts.find((x) => x.id === id);
  if (!w) return;
  $overlay.classList.remove("hidden");
  $overlay.innerHTML = `
    <div class="ov-header">
      <button class="icon-btn" id="dBack">‹ 返回</button>
      <span class="ov-title">${fmtDate(w.startTime)}</span>
      <button class="icon-btn danger" id="dDelete">刪除</button>
    </div>
    <div class="card">
      <div class="form-row"><label>訓練時間（Duration）</label><span class="hint num">${fmtDuration(new Date(w.endTime) - new Date(w.startTime))}</span></div>
      <div class="form-row"><label>總訓練量（Volume）</label><span class="hint num">${fmtVolume(volumeOf(w))}</span></div>
      <div class="form-row" style="border-bottom:none"><label>備註</label>
        <input class="form-input" id="dNote" style="max-width:60%" value="${esc(w.note || "")}" placeholder="寫點什麼…"></div>
    </div>
    ${w.entries.map((en) => renderEntryCard(w, en, false)).join("")}`;

  document.getElementById("dBack").onclick = () => { $overlay.classList.add("hidden"); renderTab(); };
  document.getElementById("dDelete").onclick = () => {
    if (confirm("刪除這次訓練？所有組數紀錄將一併刪除，PR 會自動重算。")) {
      db.workouts = db.workouts.filter((x) => x.id !== w.id);
      save();
      $overlay.classList.add("hidden");
      renderTab();
    }
  };
  document.getElementById("dNote").oninput = (e) => { w.note = e.target.value; save(); };
  bindEntryCards($overlay, w, false, () => openWorkoutDetail(id));
}

/* ----- 動作 Tab ----- */
function renderExercises() {
  $view.innerHTML = `
    <h1 class="page-title">動作庫</h1>
    <input class="search-input" id="exSearch" placeholder="搜尋動作…">
    <button class="btn btn-card" id="exNew" style="margin-top:10px">＋ 新增自訂動作</button>
    <div id="exList"></div>`;
  const renderList = () => {
    const q = document.getElementById("exSearch").value.trim().toLowerCase();
    const list = db.exercises.filter((e) => !e.isArchived &&
      (!q || e.nameZh.toLowerCase().includes(q) || e.nameEn.toLowerCase().includes(q)));
    document.getElementById("exList").innerHTML = Object.keys(MUSCLE_GROUPS).map((g) => {
      const inGroup = list.filter((e) => e.muscleGroup === g);
      if (!inGroup.length) return "";
      return `<div class="group-header">${MUSCLE_GROUPS[g].zh}（${MUSCLE_GROUPS[g].en}）</div>` +
        inGroup.map((e) => `<button class="list-item" data-ex="${e.id}">
          <div class="li-row"><span><span class="li-title">${esc(e.nameZh)}</span>
            <span class="li-sub">　${esc(e.nameEn)}</span></span>
            <span class="li-sub">${e.isCustom ? "自訂" : ""}${e.isBodyweight ? " 自重" : ""}</span></div>
        </button>`).join("");
    }).join("");
    document.getElementById("exList").querySelectorAll("[data-ex]").forEach((el) => {
      el.onclick = () => openExerciseDetail(el.dataset.ex);
    });
  };
  document.getElementById("exSearch").oninput = renderList;
  document.getElementById("exNew").onclick = () => openExerciseEditor(null);
  renderList();
}

/* ----- 動作詳情 ----- */
function openExerciseDetail(id) {
  const ex = exerciseById(id);
  if (!ex) return;
  const sets = allSetsOf(id, null);
  const sessions = sessionHistory(id);
  const maxW = maxWeight(sets), e1rm = bestE1RM(sets);
  const maxSession = sessions.length
    ? Math.max(...sessions.map((s) => s.sets.filter((x) => x.setType !== "warmup").reduce((a, x) => a + x.weightKg * x.reps, 0)))
    : null;

  // 趨勢圖（各場最佳重量，最舊到最新，最多 12 場）
  const points = sessions.slice(0, 12).reverse()
    .map((s) => maxWeight(s.sets)).filter((v) => v != null).map((kg) => toDisplay(kg));
  let svg = "";
  if (points.length >= 2) {
    const min = Math.min(...points), max = Math.max(...points), range = max - min || 1;
    const W = 320, H = 130, pad = 12;
    const coords = points.map((v, i) => [
      pad + (i * (W - 2 * pad)) / (points.length - 1),
      H - pad - ((v - min) / range) * (H - 2 * pad),
    ]);
    svg = `<div class="card"><div class="stat-title" style="margin-bottom:6px">重量趨勢（Weight Trend）· 各場最佳（${db.settings.unit}）</div>
      <svg class="trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <polyline points="${coords.map((c) => c.join(",")).join(" ")}" fill="none" stroke="#4ADE80" stroke-width="2.5" stroke-linejoin="round"/>
        ${coords.map((c) => `<circle cx="${c[0]}" cy="${c[1]}" r="3.5" fill="#4ADE80"/>`).join("")}
      </svg></div>`;
  }

  $overlay.classList.remove("hidden");
  $overlay.innerHTML = `
    <div class="ov-header">
      <button class="icon-btn" id="xBack">‹ 返回</button>
      <span class="ov-title">${esc(ex.nameZh)}</span>
      <button class="icon-btn" id="xEdit">編輯</button>
    </div>
    <div style="margin-bottom:14px">
      <span class="tag" style="color:${MUSCLE_GROUPS[ex.muscleGroup].color}">${MUSCLE_GROUPS[ex.muscleGroup].zh}（${MUSCLE_GROUPS[ex.muscleGroup].en}）</span>
      <span class="tag">${PATTERNS[ex.movementPattern]}</span>
      ${ex.isBodyweight ? `<span class="tag">自重（Bodyweight）</span>` : ""}
    </div>
    <div class="stat-grid" style="grid-template-columns:1fr 1fr 1fr">
      <div class="card stat-card"><div class="stat-title">最大重量</div><div class="stat-value" style="font-size:20px">${maxW ? trimNum(toDisplay(maxW)) : "—"}</div><div class="stat-caption">${db.settings.unit}</div></div>
      <div class="card stat-card"><div class="stat-title">估算 1RM</div><div class="stat-value" style="font-size:20px">${e1rm ? trimNum(toDisplay(e1rm)) : "—"}</div><div class="stat-caption">${db.settings.unit}</div></div>
      <div class="card stat-card"><div class="stat-title">最大單場量</div><div class="stat-value" style="font-size:16px">${maxSession ? fmtVolume(maxSession) : "—"}</div><div class="stat-caption">Volume</div></div>
    </div>
    ${svg}
    <h2 class="section-title">歷史（History）</h2>
    ${sessions.length ? sessions.map((s) => `<div class="card">
      <div class="li-top"><span class="li-title">${fmtDate(s.date)}</span>
        <span class="li-sub num">${fmtVolume(s.sets.filter((x) => x.setType !== "warmup").reduce((a, x) => a + x.weightKg * x.reps, 0))}</span></div>
      <div class="sets-summary">${s.sets.map((x) => `${trimNum(toDisplay(x.weightKg))}×${x.reps}`).join("　")}</div>
    </div>`).join("") : `<div class="empty">還沒有紀錄——在訓練中加入這個動作後，歷史與 PR 會顯示在這裡。</div>`}
    <button class="btn btn-card" id="xArchive" style="margin-top:8px">${ex.isArchived ? "取消封存" : "封存（不刪除歷史）"}</button>`;

  document.getElementById("xBack").onclick = () => { $overlay.classList.add("hidden"); renderTab(); };
  document.getElementById("xEdit").onclick = () => openExerciseEditor(ex, () => openExerciseDetail(id));
  document.getElementById("xArchive").onclick = () => {
    ex.isArchived = !ex.isArchived;
    save();
    $overlay.classList.add("hidden");
    renderTab();
  };
}

/* ----- 動作編輯器 ----- */
function openExerciseEditor(ex, onDone) {
  const isNew = !ex;
  $modal.classList.remove("hidden");
  $modal.innerHTML = `<div class="modal-sheet">
    <div class="ov-header" style="position:static;background:none;padding:0 0 8px">
      <button class="icon-btn" id="eCancel">取消</button>
      <span class="ov-title">${isNew ? "新增動作" : "編輯動作"}</span>
      <button class="icon-btn accent" id="eSave">儲存</button>
    </div>
    <div class="form-row"><label style="flex-shrink:0">中文名稱</label><input class="form-input" id="eZh" value="${esc(ex?.nameZh || "")}" placeholder="如：臥推"></div>
    <div class="form-row"><label style="flex-shrink:0">英文名稱</label><input class="form-input" id="eEn" value="${esc(ex?.nameEn || "")}" placeholder="如：Bench Press"></div>
    <div class="form-row"><label>肌群（Muscle Group）</label>
      <select class="form-select" id="eGroup">${Object.keys(MUSCLE_GROUPS).map((g) =>
        `<option value="${g}" ${ex?.muscleGroup === g ? "selected" : ""}>${MUSCLE_GROUPS[g].zh}（${MUSCLE_GROUPS[g].en}）</option>`).join("")}</select></div>
    <div class="form-row"><label>動作模式（Pattern）</label>
      <select class="form-select" id="ePattern">${Object.keys(PATTERNS).map((p) =>
        `<option value="${p}" ${ex?.movementPattern === p ? "selected" : ""}>${PATTERNS[p]}</option>`).join("")}</select></div>
    <div class="form-row" style="border-bottom:none"><label>自重動作（Bodyweight）</label>
      <input type="checkbox" id="eBw" ${ex?.isBodyweight ? "checked" : ""} style="width:20px;height:20px;accent-color:#4ADE80"></div>
  </div>`;
  document.getElementById("eCancel").onclick = () => $modal.classList.add("hidden");
  document.getElementById("eSave").onclick = () => {
    const zh = document.getElementById("eZh").value.trim();
    if (!zh) return alert("請輸入中文名稱");
    const en = document.getElementById("eEn").value.trim() || zh;
    const data = {
      nameZh: zh, nameEn: en,
      muscleGroup: document.getElementById("eGroup").value,
      movementPattern: document.getElementById("ePattern").value,
      isBodyweight: document.getElementById("eBw").checked,
    };
    if (isNew) db.exercises.push({ id: uid(), ...data, isCustom: true, isArchived: false });
    else Object.assign(ex, data);
    save();
    $modal.classList.add("hidden");
    onDone ? onDone() : renderTab();
  };
}

/* ----- 設定 ----- */
function renderSettings() {
  const s = db.settings;
  $view.innerHTML = `
    <h1 class="page-title">設定</h1>
    <div class="card">
      <div class="form-row"><label>重量單位（Weight）</label>
        <div class="seg" id="segUnit">
          <button data-u="kg" class="${s.unit === "kg" ? "on" : ""}">公斤 kg</button>
          <button data-u="lb" class="${s.unit === "lb" ? "on" : ""}">磅 lb</button>
        </div></div>
      <div class="form-row" style="border-bottom:none"><label>預設休息時間（Rest）</label>
        <div class="stepper">
          <button id="restMinus">−</button>
          <span class="num" id="restVal">${s.restSeconds} 秒</span>
          <button id="restPlus">＋</button>
        </div></div>
    </div>
    <div class="card" style="color:var(--text-2);font-size:12.5px;line-height:1.6">
      切換單位只影響顯示，歷史資料以公斤（kg）儲存、自動換算。
    </div>
    <h2 class="section-title">AI 教練（AI Coach）</h2>
    <div class="card">
      <div class="form-row"><label style="flex-shrink:0">API Key</label>
        <input class="form-input" type="password" id="aiKey" style="max-width:62%" placeholder="sk-ant-…" value="${esc(s.apiKey || "")}"></div>
      <div class="form-row"><label>AI 模型（Model）</label>
        <select class="form-select" id="aiModel">${Object.entries(CLAUDE_MODELS).map(([id, m]) =>
          `<option value="${id}" ${s.model === id ? "selected" : ""}>${m.name}</option>`).join("")}</select></div>
      <div class="form-row" style="border-bottom:none">
        <button class="btn-ghost btn" id="aiTest" style="width:auto;padding:9px 18px">測試連線</button>
        <span class="hint" id="aiTestResult"></span></div>
    </div>
    <div class="card" style="color:var(--text-2);font-size:12.5px;line-height:1.7">
      ${CLAUDE_MODELS[s.model]?.hint || ""}<br>
      API Key 只存在這台裝置的瀏覽器裡，直接連 Claude API、不經任何中介伺服器。
      到 <b>platform.claude.com</b> 註冊、儲值少量額度後建立 Key。共用電腦請勿儲存。
    </div>
    <h2 class="section-title">資料（Data）</h2>
    <div class="card">
      <div class="form-row"><label>動作（Exercises）</label><span class="hint num">${db.exercises.length}</span></div>
      <div class="form-row" style="border-bottom:none"><label>訓練紀錄（Workouts）</label><span class="hint num">${completedWorkouts().length}</span></div>
    </div>
    <button class="btn btn-card" id="expJson">匯出 JSON 備份</button>
    <button class="btn btn-card" id="expCsv">匯出 CSV（試算表）</button>
    <button class="btn btn-card" id="impJson">匯入 JSON（還原備份）</button>
    <input type="file" id="impFile" accept=".json" style="display:none">
    <div class="card" style="margin-top:14px;color:var(--text-2);font-size:12.5px;line-height:1.7">
      ⚠️ 資料只存在這台裝置的瀏覽器裡。清除瀏覽器資料會全部消失——請定期「匯出 JSON 備份」。<br>
      加到主畫面（分享 → 加入主畫面）可離線使用，且資料更不易被系統清除。<br><br>
      AI 週報（Weekly Report）：規劃中。　版本 0.1.0（Web）
    </div>`;

  document.getElementById("segUnit").querySelectorAll("button").forEach((b) => {
    b.onclick = () => { s.unit = b.dataset.u; save(); renderSettings(); };
  });
  document.getElementById("restMinus").onclick = () => { s.restSeconds = Math.max(15, s.restSeconds - 15); save(); renderSettings(); };
  document.getElementById("restPlus").onclick = () => { s.restSeconds = Math.min(300, s.restSeconds + 15); save(); renderSettings(); };
  document.getElementById("expJson").onclick = exportJSON;
  document.getElementById("expCsv").onclick = exportCSV;
  document.getElementById("impJson").onclick = () => document.getElementById("impFile").click();
  document.getElementById("impFile").onchange = importJSON;

  document.getElementById("aiKey").oninput = (e) => { s.apiKey = e.target.value.trim(); save(); };
  document.getElementById("aiModel").onchange = (e) => { s.model = e.target.value; save(); renderSettings(); };
  document.getElementById("aiTest").onclick = async (e) => {
    const result = document.getElementById("aiTestResult");
    e.target.disabled = true;
    result.textContent = "測試中…";
    try {
      await testClaudeKey();
      result.textContent = "✓ 連線成功";
      result.style.color = "var(--accent)";
    } catch (err) {
      result.textContent = err.message;
      result.style.color = "var(--danger)";
    }
    e.target.disabled = false;
  };
}

function download(filename, text, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function today() { return new Date().toISOString().slice(0, 10); }
function exportJSON() {
  download(`fitlog-backup-${today()}.json`, JSON.stringify(db, null, 2), "application/json");
}
function exportCSV() {
  const rows = [["date", "exercise_zh", "exercise_en", "muscle_group", "set_index", "weight_kg", "reps", "set_type", "rest_sec"]];
  for (const w of completedWorkouts())
    for (const en of w.entries) {
      const ex = exerciseById(en.exerciseId);
      en.sets.forEach((s, i) => {
        if (!s.completedAt) return;
        rows.push([w.startTime.slice(0, 10), ex?.nameZh || "", ex?.nameEn || "", ex?.muscleGroup || "",
          i + 1, s.weightKg, s.reps, s.setType, s.restSec ?? ""]);
      });
    }
  const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  download(`fitlog-${today()}.csv`, csv, "text/csv");
}
function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.exercises || !data.workouts) throw new Error();
      if (confirm(`將以備份取代目前資料（${data.workouts.length} 筆訓練）。確定？`)) {
        db = data;
        db.settings = Object.assign({ unit: "kg", restSeconds: 90 }, db.settings);
        save();
        renderTab();
        renderMiniBar();
        showToast("✓ 已還原備份");
      }
    } catch (_) { alert("檔案格式不正確"); }
  };
  reader.readAsText(file);
  e.target.value = "";
}

/* =====================================================================
   進行中訓練（Active Workout）
   ===================================================================== */
function renderEntryCard(workout, entry, isActive) {
  const ex = exerciseById(entry.exerciseId);
  return `<div class="exercise-card" data-entry="${entry.id}">
    <div class="ex-header">
      <span class="ex-name">${esc(ex?.nameZh || "（動作已刪除）")}<small>${esc(ex?.nameEn || "")}</small></span>
      ${ex ? `<span class="tag" style="color:${MUSCLE_GROUPS[ex.muscleGroup].color}">${MUSCLE_GROUPS[ex.muscleGroup].zh}</span>` : ""}
      ${isActive ? `<button class="mini-del" data-action="remove-entry">✕</button>` : ""}
    </div>
    ${entry.sets.map((s, i) => `
      <div class="set-row" data-set="${s.id}">
        <button class="set-num ${s.setType}" data-action="cycle-type" title="點擊切換組類型">
          ${s.setType === "working" ? i + 1 : s.setType === "warmup" ? "熱" : "力"}</button>
        <input class="set-input" type="number" step="any" inputmode="decimal" data-action="weight"
          value="${s.weightKg ? trimNum(toDisplay(s.weightKg)) : ""}" placeholder="0">
        <span class="set-unit">${db.settings.unit}</span><span class="set-x">×</span>
        <input class="set-input reps" type="number" inputmode="numeric" data-action="reps"
          value="${s.reps || ""}" placeholder="0">
        <span class="set-unit">次</span>
        <span class="set-spacer"></span>
        ${isActive ? `<button class="check-btn ${s.completedAt ? "done" : ""}" data-action="toggle">✓</button>` : ""}
        <button class="mini-del" data-action="del-set">−</button>
      </div>`).join("")}
    ${isActive ? `<button class="btn-ghost btn" data-action="add-set" style="width:100%">＋ 加一組（Set）</button>` : ""}
  </div>`;
}

function bindEntryCards(container, workout, isActive, rerender) {
  container.querySelectorAll(".exercise-card").forEach((card) => {
    const entry = workout.entries.find((e) => e.id === card.dataset.entry);
    if (!entry) return;

    card.querySelectorAll(".set-row").forEach((row) => {
      const set = entry.sets.find((s) => s.id === row.dataset.set);
      if (!set) return;

      row.querySelector('[data-action="weight"]').oninput = (e) => {
        set.weightKg = toKg(parseFloat(e.target.value) || 0);
        save();
      };
      row.querySelector('[data-action="reps"]').oninput = (e) => {
        set.reps = parseInt(e.target.value) || 0;
        save();
      };
      row.querySelector('[data-action="cycle-type"]').onclick = () => {
        set.setType = SET_TYPES[(SET_TYPES.indexOf(set.setType) + 1) % SET_TYPES.length];
        save();
        rerender();
      };
      row.querySelector('[data-action="del-set"]').onclick = () => {
        entry.sets = entry.sets.filter((s) => s.id !== set.id);
        save();
        rerender();
      };
      const toggle = row.querySelector('[data-action="toggle"]');
      if (toggle) toggle.onclick = () => {
        if (set.completedAt) {
          set.completedAt = null;
          set.restSec = null;
          save();
        } else {
          const kind = completeSet(workout, set);
          startRest(db.settings.restSeconds);
          if (kind) showToast(`🏆 新紀錄！${PR_LABELS[kind]}`);
          if (navigator.vibrate) navigator.vibrate(30);
        }
        rerender();
      };
    });

    const addBtn = card.querySelector('[data-action="add-set"]');
    if (addBtn) addBtn.onclick = () => { addSet(entry); rerender(); };
    const removeBtn = card.querySelector('[data-action="remove-entry"]');
    if (removeBtn) removeBtn.onclick = () => {
      if (confirm("移除這個動作？")) {
        workout.entries = workout.entries.filter((e) => e.id !== entry.id);
        save();
        rerender();
      }
    };
  });
}

function openWorkoutOverlay() {
  const w = activeWorkout();
  if (!w) return;
  $workoutOv.classList.remove("hidden");
  renderMiniBar();

  const hasCompleted = w.entries.some((en) => en.sets.some((s) => s.completedAt));
  $workoutOv.innerHTML = `
    <div class="ov-header">
      <button class="icon-btn" id="wCollapse">▾ 收合</button>
      <span class="ov-title num" id="elapsed">0:00</span>
      <button class="icon-btn accent" id="wFinish">結束</button>
    </div>
    <div id="entryList">${w.entries.map((en) => renderEntryCard(w, en, true)).join("")}</div>
    <button class="btn btn-card" id="wAddEx">＋ 新增動作（Exercise）</button>
    <div style="height:90px"></div>
    <div class="rest-bar" id="restBar"></div>`;

  document.getElementById("wCollapse").onclick = closeWorkoutOverlay;
  document.getElementById("wAddEx").onclick = () => openExercisePicker((ex) => {
    addExerciseToWorkout(w, ex);
    openWorkoutOverlay();
  });
  document.getElementById("wFinish").onclick = () => {
    if (hasCompleted || w.entries.some((en) => en.sets.some((s) => s.completedAt))) {
      if (confirm("結束訓練並儲存？（未完成的組會被移除）")) {
        finishWorkout(w);
        cancelRest();
        closeWorkoutOverlay();
        renderTab();
      }
    } else if (confirm("這次訓練沒有任何完成的組，要放棄嗎？")) {
      discardWorkout(w);
      cancelRest();
      closeWorkoutOverlay();
      renderTab();
    }
  };
  bindEntryCards($workoutOv, w, true, openWorkoutOverlay);
  restBarWasRunning = null;
  renderRestBar();
}
function closeWorkoutOverlay() {
  $workoutOv.classList.add("hidden");
  renderMiniBar();
  renderTab();
}

/* ----- 動作選擇器 ----- */
function openExercisePicker(onSelect) {
  $modal.classList.remove("hidden");
  $modal.innerHTML = `<div class="modal-sheet">
    <div class="ov-header" style="position:static;background:none;padding:0 0 8px">
      <button class="icon-btn" id="pCancel">取消</button>
      <span class="ov-title">選擇動作</span><span style="width:52px"></span>
    </div>
    <input class="search-input" id="pSearch" placeholder="搜尋動作…">
    <div id="pList"></div>
  </div>`;
  const renderList = () => {
    const q = document.getElementById("pSearch").value.trim().toLowerCase();
    const list = db.exercises.filter((e) => !e.isArchived &&
      (!q || e.nameZh.toLowerCase().includes(q) || e.nameEn.toLowerCase().includes(q)));
    document.getElementById("pList").innerHTML = Object.keys(MUSCLE_GROUPS).map((g) => {
      const inGroup = list.filter((e) => e.muscleGroup === g);
      if (!inGroup.length) return "";
      return `<div class="group-header">${MUSCLE_GROUPS[g].zh}（${MUSCLE_GROUPS[g].en}）</div>` +
        inGroup.map((e) => `<button class="picker-item" data-pick="${e.id}">
          <span>${esc(e.nameZh)}　<span class="li-sub">${esc(e.nameEn)}</span></span>
          ${e.isBodyweight ? `<span class="li-sub">自重</span>` : ""}
        </button>`).join("");
    }).join("");
    document.getElementById("pList").querySelectorAll("[data-pick]").forEach((el) => {
      el.onclick = () => {
        $modal.classList.add("hidden");
        onSelect(exerciseById(el.dataset.pick));
      };
    });
  };
  document.getElementById("pCancel").onclick = () => $modal.classList.add("hidden");
  document.getElementById("pSearch").oninput = renderList;
  renderList();
}

/* ----- 休息計時列 ----- */
function renderRestBar() {
  const bar = document.getElementById("restBar");
  if (!bar) return;
  const running = restRunning();
  restBarWasRunning = running;
  if (running) {
    bar.innerHTML = `
      <div class="rest-track"><div class="rest-fill" id="restFill" style="width:0%"></div></div>
      <span class="rest-time" id="restTime">${fmtClock(restRemaining() * 1000)}</span>
      <button class="rest-quick" id="restAdd">+30</button>
      <button class="rest-quick" id="restCancel">✕</button>`;
    document.getElementById("restAdd").onclick = () => {
      rest.endAt += 30000;
      rest.total += 30;
    };
    document.getElementById("restCancel").onclick = cancelRest;
  } else {
    bar.innerHTML = `
      <span class="rest-label">⏱ 休息</span><span class="set-spacer"></span>
      <button class="rest-quick" data-sec="30">30</button>
      <button class="rest-quick" data-sec="60">60</button>
      <button class="rest-quick" data-sec="90">90</button>
      <button class="rest-quick primary" data-sec="${db.settings.restSeconds}">${db.settings.restSeconds}s</button>`;
    bar.querySelectorAll("[data-sec]").forEach((b) => {
      b.onclick = () => startRest(parseInt(b.dataset.sec));
    });
  }
}

/* ----- 迷你列 ----- */
function renderMiniBar() {
  const w = activeWorkout();
  const overlayOpen = !$workoutOv.classList.contains("hidden");
  if (!w || overlayOpen) {
    $miniBar.classList.add("hidden");
    return;
  }
  $miniBar.classList.remove("hidden");
  $miniBar.innerHTML = `
    <span class="pulse-dot"></span>
    <span class="mini-title">訓練中</span>
    <span class="mini-time num" id="miniElapsed"></span>
    <span class="mini-rest num" id="miniRest"></span>
    <span class="mini-chevron">▲</span>`;
  $miniBar.onclick = openWorkoutOverlay;
}

/* ----- Toast ----- */
let toastTimer = null;
function showToast(text) {
  $toast.textContent = text;
  $toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove("show"), 2600);
}

/* ----- 每 0.5 秒更新計時顯示 ----- */
setInterval(() => {
  const w = activeWorkout();
  // 休息倒數到點
  if (rest.endAt && Date.now() >= rest.endAt) restDone();
  // 訓練畫面：經過時間 + 休息條
  const elapsed = document.getElementById("elapsed");
  if (elapsed && w) elapsed.textContent = fmtClock(Date.now() - new Date(w.startTime));
  if (restBarWasRunning !== restRunning() && document.getElementById("restBar")) renderRestBar();
  const fill = document.getElementById("restFill"), time = document.getElementById("restTime");
  if (fill && rest.total) fill.style.width = `${(1 - restRemaining() / rest.total) * 100}%`;
  if (time) time.textContent = fmtClock(restRemaining() * 1000);
  // 迷你列
  const miniElapsed = document.getElementById("miniElapsed");
  if (miniElapsed && w) miniElapsed.textContent = fmtClock(Date.now() - new Date(w.startTime));
  const miniRest = document.getElementById("miniRest");
  if (miniRest) miniRest.textContent = restRunning() ? `⏱ ${fmtClock(restRemaining() * 1000)}` : "";
}, 500);

/* ----- Service Worker（離線）----- */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* ----- 啟動 ----- */
renderTab();
renderMiniBar();
