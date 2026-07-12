/* =====================================================================
   FitLog v2 — 統計 / PR / RM（純函式，操作 FL.db）
   Volume 含單邊 ×2；1RM 用 Epley 與 Brzycki；週統計、日曆彙總。
   ===================================================================== */
"use strict";
window.FL = window.FL || {};

(function (FL) {
  const MAX_REPS_1RM = 12;

  // ---- RM 公式（估計值）----
  // Epley：1RM = w × (1 + reps/30)
  function epley(kg, reps) {
    if (reps < 1 || reps > MAX_REPS_1RM || kg <= 0) return null;
    return reps === 1 ? kg : kg * (1 + reps / 30);
  }
  // Brzycki：1RM = w × 36 / (37 − reps)
  function brzycki(kg, reps) {
    if (reps < 1 || reps > MAX_REPS_1RM || kg <= 0) return null;
    return reps === 1 ? kg : (kg * 36) / (37 - reps);
  }
  // 兩式平均，作為趨勢用的單一估算 1RM
  function estimated1RM(kg, reps) {
    const e = epley(kg, reps), b = brzycki(kg, reps);
    if (e == null || b == null) return e || b;
    return (e + b) / 2;
  }
  // 由 1RM 反推某 RM 對應重量（Epley 反式）；reps=1 即 1RM 本身
  function weightForReps(oneRM, reps) {
    if (!oneRM || reps < 1) return null;
    return reps === 1 ? oneRM : oneRM / (1 + reps / 30);
  }
  // RM 表：1/3/5/8/10RM（估計）
  function rmTable(oneRM) {
    if (!oneRM) return null;
    return [1, 3, 5, 8, 10].map((r) => ({ rm: r, kg: weightForReps(oneRM, r) }));
  }

  // ---- Volume（含單邊 ×2）----
  function unilateralMult(exercise) { return exercise && exercise.isUnilateral ? 2 : 1; }
  function setVolume(set, exercise) {
    if (!set.completedAt || set.setType === "warmup") return 0;
    return set.weightKg * set.reps * unilateralMult(exercise);
  }
  function entryVolume(entry) {
    const ex = FL.exerciseById(entry.exerciseId);
    return entry.sets.reduce((a, s) => a + setVolume(s, ex), 0);
  }
  function volumeOf(workout) {
    return workout.entries.reduce((a, en) => a + entryVolume(en), 0);
  }

  // ---- 完成、計分 ----
  function completedWorkouts() { return FL.db.workouts.filter((w) => w.endTime); }
  function scoringSets(sets) { return sets.filter((s) => s.completedAt && s.setType !== "warmup"); }

  // ---- PR（即時計算、不落地）----
  function allSetsOf(exerciseId, excludeSetId) {
    const out = [];
    for (const w of FL.db.workouts)
      for (const en of w.entries)
        if (en.exerciseId === exerciseId)
          for (const s of en.sets)
            if (s.id !== excludeSetId) out.push(s);
    return out;
  }
  function maxWeight(sets) {
    const w = scoringSets(sets).map((s) => s.weightKg).filter((v) => v > 0);
    return w.length ? Math.max(...w) : null;
  }
  function maxReps(sets) {
    const r = scoringSets(sets).map((s) => s.reps).filter((v) => v > 0);
    return r.length ? Math.max(...r) : null;
  }
  function bestE1RM(sets) {
    const v = scoringSets(sets).map((s) => estimated1RM(s.weightKg, s.reps)).filter((x) => x != null);
    return v.length ? Math.max(...v) : null;
  }
  function repPRs(sets) {
    const map = {};
    for (const s of scoringSets(sets))
      if (s.reps >= 1 && s.reps <= MAX_REPS_1RM && s.weightKg > 0)
        map[s.reps] = Math.max(map[s.reps] || 0, s.weightKg);
    return map;
  }
  // 破 PR 偵測（新完成的一組 vs 歷史，history 不含此組）
  function prKind(set, history) {
    if (set.setType === "warmup" || set.weightKg <= 0 || set.reps <= 0) return null;
    const scoring = scoringSets(history);
    if (!scoring.length) return null;
    if (set.weightKg > (maxWeight(scoring) || 0)) return "maxWeight";
    const e = estimated1RM(set.weightKg, set.reps);
    if (e != null && e > (bestE1RM(scoring) || 0)) return "estimated1RM";
    if (set.reps <= MAX_REPS_1RM && set.weightKg > (repPRs(scoring)[set.reps] || 0)) return "maxWeight";
    if (set.reps > (maxReps(scoring) || 0)) return "maxReps";
    return null;
  }

  // ---- 週統計（週一起始）----
  function weekStartOf(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  function workoutsInWeek(refDate) {
    const start = weekStartOf(refDate), end = new Date(start.getTime() + 7 * 86400000);
    return completedWorkouts().filter((w) => {
      const t = new Date(w.startTime);
      return t >= start && t < end;
    });
  }
  function workoutsInDays(days, refDate) {
    const now = refDate ? new Date(refDate) : new Date();
    const start = new Date(now.getTime() - days * 86400000);
    return completedWorkouts().filter((w) => new Date(w.startTime) >= start);
  }
  function workoutsOnDate(dateStr) {
    return completedWorkouts().filter((w) => localDateKey(w.startTime) === dateStr);
  }
  function localDateKey(iso) {
    const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function weekSummary(refDate) {
    const week = workoutsInWeek(refDate || new Date());
    const totalDuration = week.reduce((a, w) => a + (new Date(w.endTime) - new Date(w.startTime)), 0);
    const totalVolume = week.reduce((a, w) => a + volumeOf(w), 0);
    const top = muscleDistribution(week)[0];
    return { workoutCount: week.length, totalDuration, totalVolume, topMuscle: top ? top.group : null };
  }

  function weeklyTrend(weeks, refDate) {
    const out = [];
    const ref = refDate ? new Date(refDate) : new Date();
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(ref); d.setDate(d.getDate() - i * 7);
      const list = workoutsInWeek(d);
      const ws = weekStartOf(d);
      out.push({
        weekStart: ws,
        label: `${ws.getMonth() + 1}/${ws.getDate()}`,
        volume: list.reduce((a, w) => a + volumeOf(w), 0),
        count: list.length,
        duration: list.reduce((a, w) => a + (new Date(w.endTime) - new Date(w.startTime)), 0),
      });
    }
    return out;
  }

  // 依主要肌群加總 Volume
  function muscleDistribution(workouts) {
    const totals = {};
    for (const w of workouts)
      for (const en of w.entries) {
        const ex = FL.exerciseById(en.exerciseId);
        if (!ex) continue;
        totals[ex.muscleGroup] = (totals[ex.muscleGroup] || 0) + entryVolume(en);
      }
    return Object.entries(totals).filter(([, v]) => v > 0)
      .map(([group, volume]) => ({ group, volume }))
      .sort((a, b) => b.volume - a.volume);
  }

  // 動作模式平衡（推/拉/膝/髖）
  function movementBalance(workouts) {
    const b = { push: 0, pull: 0, squat: 0, hinge: 0, core: 0, cardio: 0 };
    for (const w of workouts)
      for (const en of w.entries) {
        const ex = FL.exerciseById(en.exerciseId);
        if (!ex || b[ex.movementPattern] === undefined) continue;
        b[ex.movementPattern] += entryVolume(en);
      }
    return b;
  }

  // 某動作逐場歷史（新到舊）
  function sessionHistory(exerciseId) {
    const sessions = [];
    for (const w of completedWorkouts())
      for (const en of w.entries) {
        if (en.exerciseId !== exerciseId) continue;
        const sets = en.sets.filter((s) => s.completedAt);
        if (sets.length) sessions.push({ date: w.startTime, sets, entry: en });
      }
    return sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  function maxSessionVolume(exerciseId) {
    const ex = FL.exerciseById(exerciseId);
    const vols = sessionHistory(exerciseId).map((s) =>
      s.sets.filter((x) => x.setType !== "warmup").reduce((a, x) => a + x.weightKg * x.reps * unilateralMult(ex), 0));
    return vols.length ? Math.max(...vols) : null;
  }

  // 某動作上一次的完成組（供帶入）
  function lastPerformance(exerciseId, excludeWorkoutId) {
    const list = FL.db.workouts
      .filter((w) => w.id !== excludeWorkoutId)
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    for (const w of list)
      for (const en of w.entries) {
        if (en.exerciseId !== exerciseId) continue;
        const done = en.sets.filter((s) => s.completedAt);
        if (done.length) return { sets: done, date: w.startTime };
      }
    return null;
  }

  function trainingAgeWeeks() {
    const first = completedWorkouts().map((w) => new Date(w.startTime)).sort((a, b) => a - b)[0];
    return first ? Math.max(1, Math.round((Date.now() - first) / (7 * 86400000))) : 0;
  }

  Object.assign(FL, {
    MAX_REPS_1RM,
    epley, brzycki, estimated1RM, weightForReps, rmTable,
    unilateralMult, setVolume, entryVolume, volumeOf,
    completedWorkouts, scoringSets, allSetsOf,
    maxWeight, maxReps, bestE1RM, repPRs, prKind,
    weekStartOf, workoutsInWeek, workoutsInDays, workoutsOnDate, localDateKey,
    weekSummary, weeklyTrend, muscleDistribution, movementBalance,
    sessionHistory, maxSessionVolume, lastPerformance, trainingAgeWeeks,
  });
})(window.FL);
