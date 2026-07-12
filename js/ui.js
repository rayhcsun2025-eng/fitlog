/* =====================================================================
   FitLog v2 — UI 核心
   分頁路由、總覽、日曆、訓練（記錄/補記錄/進行中/詳情/回饋）、更多。
   AI 教練分頁由 coach.js 註冊。共用 helper 掛在 FL.ui。
   ===================================================================== */
"use strict";
window.FL = window.FL || {};

(function (FL) {
  const $ = (id) => document.getElementById(id);
  const ui = {};
  FL.ui = ui;

  let els = {};
  ui.init = function () {
    els = {
      view: $("view"), overlay: $("overlay"), workoutOverlay: $("workoutOverlay"),
      modal: $("modal"), miniBar: $("miniBar"), toast: $("toast"),
    };
    ui.els = els;
  };

  // ---- 共用 helper ----
  const { esc, fmtWeight, fmtVolume, fmtDuration, fmtClock, fmtDate, trimNum, toDisplay, toKg,
    MUSCLE_GROUPS, PATTERNS, EQUIPMENT, SET_TYPES, FEEDBACK, PR_LABELS, save, uid, exerciseById } = FL;

  ui.currentTab = "dashboard";
  ui.renderTab = function () {
    const t = ui.currentTab;
    if (t === "dashboard") renderDashboard();
    else if (t === "calendar") renderCalendar();
    else if (t === "workouts") renderWorkouts();
    else if (t === "coach") ui.renderCoach ? ui.renderCoach() : (els.view.innerHTML = "");
    else if (t === "more") renderMore();
    ui.renderMiniBar();
  };

  let toastTimer = null;
  ui.showToast = function (text) {
    els.toast.textContent = text;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
  };
  ui.closeOverlay = function () { els.overlay.classList.add("hidden"); ui.renderTab(); };
  ui.closeModal = function () { els.modal.classList.add("hidden"); };

  function groupLabel(g) { const m = MUSCLE_GROUPS[g]; return m ? `${m.zh}（${m.en}）` : g; }
  function muscleTag(g, compact) {
    const m = MUSCLE_GROUPS[g]; if (!m) return "";
    return `<span class="tag" style="color:${m.color}">${compact ? m.zh : groupLabel(g)}</span>`;
  }

  /* =================== 總覽 Dashboard =================== */
  function renderDashboard() {
    const done = FL.completedWorkouts();
    let html = `<h1 class="page-title">總覽</h1>`;
    if (!done.length) {
      html += `<div class="empty"><span class="empty-icon">📊</span>還沒有資料<br>完成第一次訓練後，這裡會顯示週統計、趨勢與 AI 分析。</div>`;
      els.view.innerHTML = html;
      return;
    }
    const s = FL.weekSummary(new Date());
    const trend = FL.weeklyTrend(4, new Date());
    const dist = FL.muscleDistribution(FL.workoutsInDays(28));
    const maxVol = Math.max(...trend.map((t) => t.volume), 1);
    const distTotal = dist.reduce((a, d) => a + d.volume, 0) || 1;

    html += `
      <h2 class="section-title" style="margin-top:0">本週</h2>
      <div class="stat-grid">
        <div class="card stat-card"><div class="stat-title">訓練次數（Frequency）</div><div class="stat-value">${s.workoutCount}</div><div class="stat-caption">次</div></div>
        <div class="card stat-card"><div class="stat-title">總訓練時間（Duration）</div><div class="stat-value" style="font-size:20px">${s.totalDuration ? fmtDuration(s.totalDuration) : "—"}</div></div>
        <div class="card stat-card"><div class="stat-title">總訓練量（Volume）</div><div class="stat-value" style="font-size:20px">${s.totalVolume ? fmtVolume(s.totalVolume) : "—"}</div></div>
        <div class="card stat-card"><div class="stat-title">最多肌群（Top Group）</div><div class="stat-value" style="font-size:20px">${s.topMuscle ? MUSCLE_GROUPS[s.topMuscle].zh : "—"}</div><div class="stat-caption">${s.topMuscle ? MUSCLE_GROUPS[s.topMuscle].en : ""}</div></div>
      </div>
      <h2 class="section-title">近四週</h2>
      <div class="card">
        <div class="stat-title" style="margin-bottom:10px">訓練量趨勢（Volume Trend）</div>
        <div class="bar-chart">${trend.map((t) => `<div class="bar-col">
          <div class="bar-value">${t.volume ? fmtVolume(t.volume) : ""}</div>
          <div class="bar" style="height:${Math.max(2, (t.volume / maxVol) * 100)}%"></div>
          <div class="bar-label">${t.label}</div></div>`).join("")}</div>
      </div>
      <div class="card">
        <div class="stat-title" style="margin-bottom:4px">肌群分布（Muscle Groups）· 近四週</div>
        ${dist.length ? dist.map((d) => `<div class="dist-row">
          <span class="dist-name">${MUSCLE_GROUPS[d.group].zh}</span>
          <div class="dist-track"><div class="dist-fill" style="width:${(d.volume / distTotal) * 100}%;background:${MUSCLE_GROUPS[d.group].color}"></div></div>
          <span class="dist-pct">${Math.round((d.volume / distTotal) * 100)}%</span></div>`).join("") : `<div class="empty" style="padding:16px">尚無資料</div>`}
      </div>
      ${ui.aiReportSectionHTML ? ui.aiReportSectionHTML() : ""}`;
    els.view.innerHTML = html;
    if (ui.bindAiReportSection) ui.bindAiReportSection(els.view);
  }

  /* =================== 日曆 Calendar =================== */
  let calMonth = null; // Date（該月第一天）
  function renderCalendar() {
    if (!calMonth) { const n = new Date(); calMonth = new Date(n.getFullYear(), n.getMonth(), 1); }
    const year = calMonth.getFullYear(), month = calMonth.getMonth();
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // 週一=0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const p = (n) => String(n).padStart(2, "0");

    // 每天的肌群分布
    const dayInfo = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${p(month + 1)}-${p(d)}`;
      const ws = FL.workoutsOnDate(key);
      if (ws.length) dayInfo[key] = FL.muscleDistribution(ws);
    }

    let cells = "";
    for (let i = 0; i < firstDow; i++) cells += `<div class="cal-cell empty-cell"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${p(month + 1)}-${p(d)}`;
      const dist = dayInfo[key];
      const isToday = key === FL.localDateKey(new Date().toISOString());
      let inner = `<span class="cal-day ${isToday ? "today" : ""}">${d}</span>`;
      if (dist && dist.length) {
        const top = dist[0].group;
        inner = `<span class="cal-day ${isToday ? "today" : ""}">${d}</span>
          <span class="cal-dots">${dist.slice(0, 4).map((x) => `<span class="cal-dot" style="background:${MUSCLE_GROUPS[x.group].color}"></span>`).join("")}</span>`;
        cells += `<button class="cal-cell has" data-day="${key}" style="background:${MUSCLE_GROUPS[top].color}22">${inner}</button>`;
      } else {
        cells += `<div class="cal-cell">${inner}</div>`;
      }
    }

    els.view.innerHTML = `
      <div class="cal-header">
        <button class="icon-btn" id="calPrev">‹</button>
        <h1 class="page-title" style="margin:0;font-size:22px">${year} 年 ${month + 1} 月</h1>
        <button class="icon-btn" id="calNext">›</button>
      </div>
      <div class="cal-weekdays">${["一","二","三","四","五","六","日"].map((w) => `<span>${w}</span>`).join("")}</div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-legend">${Object.keys(MUSCLE_GROUPS).map((g) =>
        `<span class="cal-leg"><span class="cal-dot" style="background:${MUSCLE_GROUPS[g].color}"></span>${MUSCLE_GROUPS[g].zh}</span>`).join("")}</div>`;

    $("calPrev").onclick = () => { calMonth = new Date(year, month - 1, 1); renderCalendar(); };
    $("calNext").onclick = () => { calMonth = new Date(year, month + 1, 1); renderCalendar(); };
    els.view.querySelectorAll("[data-day]").forEach((el) => { el.onclick = () => openDayDetail(el.dataset.day); });
  }

  function openDayDetail(dateKey) {
    const ws = FL.workoutsOnDate(dateKey);
    els.overlay.classList.remove("hidden");
    els.overlay.innerHTML = `
      <div class="ov-header"><button class="icon-btn" id="ddBack">‹ 返回</button>
        <span class="ov-title">${dateKey}</span><span style="width:52px"></span></div>
      ${ws.map((w) => {
        const groups = [...new Set(w.entries.map((en) => exerciseById(en.exerciseId)?.muscleGroup).filter(Boolean))];
        return `<button class="list-item" data-workout="${w.id}">
          <div class="li-top"><span class="li-title">${new Date(w.startTime).toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}</span>
            <span class="li-sub num">${fmtDuration(new Date(w.endTime)-new Date(w.startTime))}</span></div>
          <div class="li-row"><span class="li-sub num">${fmtVolume(FL.volumeOf(w))}</span>
            <span>${groups.slice(0,4).map((g)=>muscleTag(g,true)).join(" ")}</span></div></button>`;
      }).join("")}`;
    $("ddBack").onclick = () => { els.overlay.classList.add("hidden"); ui.renderTab(); };
    els.overlay.querySelectorAll("[data-workout]").forEach((el) => { el.onclick = () => openWorkoutDetail(el.dataset.workout); });
  }

  /* =================== 訓練 Workouts =================== */
  function renderWorkouts() {
    const done = FL.completedWorkouts().sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    const active = FL.db.workouts.find((w) => !w.endTime);
    els.view.innerHTML = `
      <h1 class="page-title">訓練</h1>
      <button class="btn ${active ? "btn-card" : "btn-primary"}" id="startBtn">${active ? "▲ 回到訓練" : "＋ 開始訓練（Workout）"}</button>
      <button class="btn btn-card" id="backfillBtn">🗓 補記錄過去的訓練</button>
      <h2 class="section-title">歷史紀錄（History）</h2>
      ${done.length ? done.map((w) => {
        const groups = [...new Set(w.entries.map((en) => exerciseById(en.exerciseId)?.muscleGroup).filter(Boolean))];
        const fb = w.feedback ? FEEDBACK[w.feedback] : null;
        return `<button class="list-item" data-workout="${w.id}">
          <div class="li-top"><span class="li-title">${fmtDate(w.startTime)}</span>
            <span class="li-sub num">${fmtDuration(new Date(w.endTime)-new Date(w.startTime))}</span></div>
          <div class="li-row"><span class="li-sub num">${fmtVolume(FL.volumeOf(w))}${fb?` · ${fb.label}`:""}</span>
            <span>${groups.slice(0,3).map((g)=>muscleTag(g,true)).join(" ")}</span></div></button>`;
      }).join("") : `<div class="empty"><span class="empty-icon">🏋️</span>還沒有訓練紀錄<br>點上方開始，或用 AI 教練排課。</div>`}`;
    $("startBtn").onclick = () => { startWorkout(); openWorkoutOverlay(); };
    $("backfillBtn").onclick = openBackfillModal;
    els.view.querySelectorAll("[data-workout]").forEach((el) => { el.onclick = () => openWorkoutDetail(el.dataset.workout); });
  }

  // ---- 訓練操作 ----
  function activeWorkout() { return FL.db.workouts.find((w) => !w.endTime) || null; }
  function startWorkout() {
    let w = activeWorkout();
    if (!w) { w = { id: uid(), startTime: new Date().toISOString(), endTime: null, note: "", feedback: null, entries: [] }; FL.db.workouts.push(w); save(); }
    return w;
  }
  function addExerciseToWorkout(workout, exercise, presetSets) {
    const entry = { id: uid(), exerciseId: exercise.id, sets: [] };
    const doneAt = workout.endTime || null;
    if (presetSets && presetSets.length) {
      for (const p of presetSets) entry.sets.push({ id: uid(), weightKg: p.weightKg || 0, reps: p.reps || 0, setType: "working", completedAt: doneAt, restSec: null });
    } else {
      const last = FL.lastPerformance(exercise.id, workout.id);
      if (last) for (const p of last.sets) entry.sets.push({ id: uid(), weightKg: p.weightKg, reps: p.reps, setType: p.setType, completedAt: doneAt, restSec: null });
      else entry.sets.push({ id: uid(), weightKg: 0, reps: 0, setType: "working", completedAt: doneAt, restSec: null });
    }
    workout.entries.push(entry);
    save();
    return entry;
  }
  function addSet(entry, workout) {
    const last = entry.sets[entry.sets.length - 1];
    entry.sets.push({ id: uid(), weightKg: last ? last.weightKg : 0, reps: last ? last.reps : 0,
      setType: last ? last.setType : "working", completedAt: workout && workout.endTime ? workout.endTime : null, restSec: null });
    save();
  }
  function completeSet(workout, set) {
    set.completedAt = new Date().toISOString();
    const entry = workout.entries.find((e) => e.sets.some((s) => s.id === set.id));
    let kind = null;
    if (entry) kind = FL.prKind(set, FL.allSetsOf(entry.exerciseId, set.id));
    save();
    return kind;
  }
  function finishWorkout(workout) {
    for (const en of workout.entries) en.sets = en.sets.filter((s) => s.completedAt);
    workout.entries = workout.entries.filter((en) => en.sets.length);
    workout.endTime = new Date().toISOString();
    save();
  }
  ui.startWorkoutFromPlan = function (plan) {
    const w = startWorkout();
    for (const item of plan.exercises) {
      const ex = exerciseById(item.exercise_id) || FL.db.exercises.find((e) => e.nameEn === item.name_en);
      if (!ex) continue;
      const sets = [];
      const n = Math.max(1, item.sets || 3);
      const reps = parseInt(String(item.reps).match(/\d+/)?.[0] || "0");
      for (let i = 0; i < n; i++) sets.push({ weightKg: item.suggested_weight_kg || 0, reps });
      addExerciseToWorkout(w, ex, sets.map((s) => ({ weightKg: s.weightKg, reps: s.reps })));
      // 上面 addExerciseToWorkout 會標記完成（因 workout.endTime null → 不完成），這裡確保未完成
    }
    // 剛建立的計畫組應為「未完成」等使用者去做
    for (const en of w.entries) for (const s of en.sets) s.completedAt = null;
    save();
    openWorkoutOverlay();
  };

  /* ---- 進行中訓練 ---- */
  function setRowHTML(set, index, unit, isActive) {
    return `<div class="set-row" data-set="${set.id}">
      <button class="set-num ${set.setType}" data-action="cycle-type">${set.setType==="working"?index+1:set.setType==="warmup"?"熱":"力"}</button>
      <input class="set-input" type="number" step="any" inputmode="decimal" data-action="weight" value="${set.weightKg?trimNum(toDisplay(set.weightKg)):""}" placeholder="0">
      <span class="set-unit">${unit}</span><span class="set-x">×</span>
      <input class="set-input reps" type="number" inputmode="numeric" data-action="reps" value="${set.reps||""}" placeholder="0">
      <span class="set-unit">次</span><span class="set-spacer"></span>
      ${isActive?`<button class="check-btn ${set.completedAt?"done":""}" data-action="toggle">✓</button>`:""}
      <button class="mini-del" data-action="del-set">−</button></div>`;
  }
  function entryCardHTML(workout, entry, isActive) {
    const ex = exerciseById(entry.exerciseId);
    const unit = FL.db.settings.unit;
    return `<div class="exercise-card" data-entry="${entry.id}">
      <div class="ex-header">
        <span class="ex-name">${esc(ex?.nameZh||"（動作已刪除）")}${ex?.isUnilateral?' <span class="uni-badge">單邊</span>':""}<small>${esc(ex?.nameEn||"")}</small></span>
        ${ex?muscleTag(ex.muscleGroup,true):""}
        <button class="mini-del" data-action="remove-entry">✕</button></div>
      ${entry.sets.map((s,i)=>setRowHTML(s,i,unit,isActive)).join("")}
      <button class="btn-ghost btn" data-action="add-set" style="width:100%">＋ 加一組（Set）</button></div>`;
  }
  function bindEntryCards(container, workout, isActive, rerender) {
    container.querySelectorAll(".exercise-card").forEach((card) => {
      const entry = workout.entries.find((e) => e.id === card.dataset.entry);
      if (!entry) return;
      card.querySelectorAll(".set-row").forEach((row) => {
        const set = entry.sets.find((s) => s.id === row.dataset.set);
        if (!set) return;
        row.querySelector('[data-action="weight"]').oninput = (e) => { set.weightKg = toKg(parseFloat(e.target.value) || 0); save(); };
        row.querySelector('[data-action="reps"]').oninput = (e) => { set.reps = parseInt(e.target.value) || 0; save(); };
        row.querySelector('[data-action="cycle-type"]').onclick = () => { set.setType = SET_TYPES[(SET_TYPES.indexOf(set.setType)+1)%SET_TYPES.length]; save(); rerender(); };
        row.querySelector('[data-action="del-set"]').onclick = () => { entry.sets = entry.sets.filter((s)=>s.id!==set.id); save(); rerender(); };
        const toggle = row.querySelector('[data-action="toggle"]');
        if (toggle) toggle.onclick = () => {
          if (set.completedAt) { set.completedAt = null; save(); }
          else { const kind = completeSet(workout, set); startRest(FL.db.settings.restSeconds); if (kind) ui.showToast(`🏆 新紀錄！${PR_LABELS[kind]}`); if (navigator.vibrate) navigator.vibrate(30); }
          rerender();
        };
      });
      const addBtn = card.querySelector('[data-action="add-set"]');
      if (addBtn) addBtn.onclick = () => { addSet(entry, workout); rerender(); };
      const rm = card.querySelector('[data-action="remove-entry"]');
      if (rm) rm.onclick = () => { if (confirm("移除這個動作？")) { workout.entries = workout.entries.filter((e)=>e.id!==entry.id); save(); rerender(); } };
    });
  }

  function openWorkoutOverlay() {
    const w = activeWorkout(); if (!w) return;
    els.workoutOverlay.classList.remove("hidden");
    ui.renderMiniBar();
    els.workoutOverlay.innerHTML = `
      <div class="ov-header">
        <button class="icon-btn" id="wCollapse">▾ 收合</button>
        <span class="ov-title num" id="elapsed">0:00</span>
        <button class="icon-btn accent" id="wFinish">結束</button></div>
      <div id="entryList">${w.entries.map((en)=>entryCardHTML(w,en,true)).join("")}</div>
      <button class="btn btn-card" id="wAddEx">＋ 新增動作（Exercise）</button>
      <div style="height:90px"></div>
      <div class="rest-bar" id="restBar"></div>`;
    $("wCollapse").onclick = closeWorkoutOverlay;
    $("wAddEx").onclick = () => openExercisePicker((ex) => { addExerciseToWorkout(w, ex); openWorkoutOverlay(); });
    $("wFinish").onclick = () => finishFlow(w);
    bindEntryCards(els.workoutOverlay, w, true, openWorkoutOverlay);
    renderRestBar();
  }
  function closeWorkoutOverlay() { els.workoutOverlay.classList.add("hidden"); ui.renderMiniBar(); ui.renderTab(); }

  function finishFlow(w) {
    const hasCompleted = w.entries.some((en) => en.sets.some((s) => s.completedAt));
    if (!hasCompleted) {
      if (confirm("這次訓練沒有任何完成的組，要放棄嗎？")) { FL.db.workouts = FL.db.workouts.filter((x)=>x.id!==w.id); save(); cancelRest(); closeWorkoutOverlay(); }
      return;
    }
    // Session 回饋
    els.modal.classList.remove("hidden");
    els.modal.innerHTML = `<div class="modal-sheet">
      <div class="ov-header" style="position:static;background:none;padding:0 0 10px">
        <span style="width:40px"></span><span class="ov-title">這次感覺如何？</span>
        <button class="icon-btn" id="fbSkip">跳過</button></div>
      <p class="hint" style="padding:0 4px 10px">用於 AI 重量建議與恢復分析</p>
      ${Object.entries(FEEDBACK).map(([k,v])=>`<button class="fb-btn" data-fb="${k}"><span>${v.label}</span><span class="hint">${v.rpe}</span></button>`).join("")}</div>`;
    const done = (fb) => { w.feedback = fb; finishWorkout(w); FL.updatePreferenceProfile(); cancelRest(); ui.closeModal(); closeWorkoutOverlay(); };
    $("fbSkip").onclick = () => done(null);
    els.modal.querySelectorAll("[data-fb]").forEach((b) => { b.onclick = () => done(b.dataset.fb); });
  }

  /* ---- 補記錄 / 詳情 ---- */
  function localDatetimeValue(iso) { const d = new Date(iso), p=(n)=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
  function openBackfillModal() {
    const y = new Date(Date.now()-86400000), p=(n)=>String(n).padStart(2,"0");
    const dv = `${y.getFullYear()}-${p(y.getMonth()+1)}-${p(y.getDate())}`;
    const now = new Date(), mx = `${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}`;
    els.modal.classList.remove("hidden");
    els.modal.innerHTML = `<div class="modal-sheet">
      <div class="ov-header" style="position:static;background:none;padding:0 0 8px">
        <button class="icon-btn" id="bCancel">取消</button><span class="ov-title">補記錄訓練</span><button class="icon-btn accent" id="bCreate">建立</button></div>
      <div class="form-row"><label>日期</label><input class="form-input" type="date" id="bDate" value="${dv}" max="${mx}" style="max-width:56%"></div>
      <div class="form-row"><label>開始時間</label><input class="form-input" type="time" id="bTime" value="18:00" style="max-width:56%"></div>
      <div class="form-row" style="border-bottom:none"><label>訓練時長（分鐘）</label><input class="form-input num" type="number" id="bDur" value="60" min="1" max="600" style="width:80px;text-align:center"></div>
      <div style="color:var(--text-2);font-size:12.5px;line-height:1.7;padding:12px 0 4px">建立後在詳情頁加入動作與組數——補的紀錄會計入統計、趨勢與 PR。</div></div>`;
    $("bCancel").onclick = ui.closeModal;
    $("bCreate").onclick = () => {
      const start = new Date(`${$("bDate").value}T${$("bTime").value||"18:00"}`);
      const dur = Math.max(1, parseInt($("bDur").value)||60);
      if (isNaN(start)) return alert("日期格式不正確");
      if (start > new Date()) return alert("不能選未來的時間");
      const w = { id: uid(), startTime: start.toISOString(), endTime: new Date(start.getTime()+dur*60000).toISOString(), note: "", feedback: null, entries: [] };
      FL.db.workouts.push(w); save(); ui.closeModal(); openWorkoutDetail(w.id);
    };
  }

  function openWorkoutDetail(id) {
    const w = FL.db.workouts.find((x) => x.id === id); if (!w) return;
    const durMin = Math.max(1, Math.round((new Date(w.endTime)-new Date(w.startTime))/60000));
    els.overlay.classList.remove("hidden");
    els.overlay.innerHTML = `
      <div class="ov-header"><button class="icon-btn" id="dBack">‹ 返回</button>
        <span class="ov-title">${fmtDate(w.startTime)}</span><button class="icon-btn danger" id="dDelete">刪除</button></div>
      <div class="card">
        <div class="form-row"><label style="flex-shrink:0">日期時間</label>
          <input class="form-input" type="datetime-local" id="dStart" style="max-width:62%" value="${localDatetimeValue(w.startTime)}" max="${localDatetimeValue(new Date().toISOString())}"></div>
        <div class="form-row"><label>訓練時間（Duration）</label>
          <span style="display:flex;align-items:center;gap:6px"><input class="form-input num" type="number" id="dDur" style="width:72px;text-align:center" value="${durMin}" min="1" max="600"><span class="hint">分鐘</span></span></div>
        <div class="form-row"><label>總訓練量（Volume）</label><span class="hint num">${fmtVolume(FL.volumeOf(w))}</span></div>
        <div class="form-row"><label>回饋</label>
          <select class="form-select" id="dFb"><option value="">未填</option>${Object.entries(FEEDBACK).map(([k,v])=>`<option value="${k}" ${w.feedback===k?"selected":""}>${v.label}</option>`).join("")}</select></div>
        <div class="form-row" style="border-bottom:none"><label>備註</label><input class="form-input" id="dNote" style="max-width:56%" value="${esc(w.note||"")}" placeholder="寫點什麼…"></div></div>
      ${w.entries.map((en)=>entryCardHTML(w,en,false)).join("")}
      <button class="btn btn-card" id="dAddEx">＋ 新增動作（Exercise）</button>`;
    const applyTime = () => {
      const sv = $("dStart").value; if (!sv) return;
      const start = new Date(sv), dur = Math.max(1, parseInt($("dDur").value)||durMin);
      if (isNaN(start) || start > new Date()) return;
      w.startTime = start.toISOString(); w.endTime = new Date(start.getTime()+dur*60000).toISOString();
      for (const en of w.entries) for (const s of en.sets) if (s.completedAt) s.completedAt = w.endTime;
      save();
    };
    $("dStart").onchange = () => { applyTime(); openWorkoutDetail(id); };
    $("dDur").onchange = () => { applyTime(); openWorkoutDetail(id); };
    $("dFb").onchange = (e) => { w.feedback = e.target.value || null; save(); };
    $("dNote").oninput = (e) => { w.note = e.target.value; save(); };
    $("dAddEx").onclick = () => openExercisePicker((ex) => { addExerciseToWorkout(w, ex); openWorkoutDetail(id); });
    $("dBack").onclick = () => { els.overlay.classList.add("hidden"); ui.renderTab(); };
    $("dDelete").onclick = () => { if (confirm("刪除這次訓練？所有組數紀錄將一併刪除，PR 會自動重算。")) { FL.db.workouts = FL.db.workouts.filter((x)=>x.id!==id); save(); els.overlay.classList.add("hidden"); ui.renderTab(); } };
    bindEntryCards(els.overlay, w, false, () => openWorkoutDetail(id));
  }
  ui.openWorkoutDetail = openWorkoutDetail;

  /* ---- 動作選擇器 ---- */
  function openExercisePicker(onSelect) {
    els.modal.classList.remove("hidden");
    els.modal.innerHTML = `<div class="modal-sheet">
      <div class="ov-header" style="position:static;background:none;padding:0 0 8px">
        <button class="icon-btn" id="pCancel">取消</button><span class="ov-title">選擇動作</span><span style="width:52px"></span></div>
      <input class="search-input" id="pSearch" placeholder="搜尋動作…"><div id="pList"></div></div>`;
    const renderList = () => {
      const q = $("pSearch").value.trim().toLowerCase();
      const list = FL.db.exercises.filter((e) => !e.isArchived && (!q || e.nameZh.toLowerCase().includes(q) || e.nameEn.toLowerCase().includes(q)));
      const favs = list.filter((e) => e.isFavorite);
      const sections = [];
      if (favs.length && !q) sections.push(["★ 收藏", favs]);
      for (const g of Object.keys(MUSCLE_GROUPS)) { const inG = list.filter((e)=>e.muscleGroup===g); if (inG.length) sections.push([groupLabel(g), inG]); }
      $("pList").innerHTML = sections.map(([title, arr]) => `<div class="group-header">${title}</div>` + arr.map((e)=>`<button class="picker-item" data-pick="${e.id}">
        <span>${esc(e.nameZh)}${e.isUnilateral?' <span class="uni-badge">單邊</span>':""}　<span class="li-sub">${esc(e.nameEn)}</span></span>
        <span class="li-sub">${e.isFavorite?"★ ":""}${EQUIPMENT[e.equipment]?.replace(/（.*/,"")||""}</span></button>`).join("")).join("");
      $("pList").querySelectorAll("[data-pick]").forEach((el) => { el.onclick = () => { ui.closeModal(); onSelect(exerciseById(el.dataset.pick)); }; });
    };
    $("pCancel").onclick = ui.closeModal;
    $("pSearch").oninput = renderList;
    renderList();
  }
  ui.openExercisePicker = openExercisePicker;

  /* ---- 休息計時器 ---- */
  const rest = { endAt: null, total: 0 };
  function restRunning() { return rest.endAt && rest.endAt > Date.now(); }
  function restRemaining() { return rest.endAt ? Math.max(0, Math.round((rest.endAt-Date.now())/1000)) : 0; }
  function startRest(sec) { rest.endAt = Date.now()+sec*1000; rest.total = sec; if ("Notification" in window && Notification.permission==="default") Notification.requestPermission(); renderRestBar(); }
  function cancelRest() { rest.endAt = null; rest.total = 0; renderRestBar(); }
  function restDone() { rest.endAt = null; rest.total = 0; beep(); if (navigator.vibrate) navigator.vibrate([200,80,200]); if ("Notification" in window && Notification.permission==="granted") new Notification("休息結束（Rest Over）",{body:"回去做下一組！"}); renderRestBar(); }
  function beep() { try { const c=new (window.AudioContext||window.webkitAudioContext)(); const o=c.createOscillator(),g=c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value=880; g.gain.value=0.12; o.start(); o.stop(c.currentTime+0.25); } catch(_){} }
  function renderRestBar() {
    const bar = $("restBar"); if (!bar) return;
    if (restRunning()) {
      bar.innerHTML = `<div class="rest-track"><div class="rest-fill" id="restFill" style="width:0%"></div></div>
        <span class="rest-time" id="restTime">${fmtClock(restRemaining()*1000)}</span>
        <button class="rest-quick" id="restAdd">+30</button><button class="rest-quick" id="restCancel">✕</button>`;
      $("restAdd").onclick = () => { rest.endAt += 30000; rest.total += 30; };
      $("restCancel").onclick = cancelRest;
    } else {
      bar.innerHTML = `<span class="rest-label">⏱ 休息</span><span class="set-spacer"></span>
        ${[30,60,90].map((s)=>`<button class="rest-quick" data-sec="${s}">${s}</button>`).join("")}
        <button class="rest-quick primary" data-sec="${FL.db.settings.restSeconds}">${FL.db.settings.restSeconds}s</button>`;
      bar.querySelectorAll("[data-sec]").forEach((b)=>{ b.onclick = () => startRest(parseInt(b.dataset.sec)); });
    }
  }

  /* ---- 迷你列 ---- */
  ui.renderMiniBar = function () {
    const w = activeWorkout();
    const overlayOpen = !els.workoutOverlay.classList.contains("hidden");
    if (!w || overlayOpen) { els.miniBar.classList.add("hidden"); return; }
    els.miniBar.classList.remove("hidden");
    els.miniBar.innerHTML = `<span class="pulse-dot"></span><span class="mini-title">訓練中</span>
      <span class="mini-time num" id="miniElapsed"></span><span class="mini-rest num" id="miniRest"></span><span class="mini-chevron">▲</span>`;
    els.miniBar.onclick = openWorkoutOverlay;
  };

  // 每 0.5 秒更新計時
  setInterval(() => {
    const w = activeWorkout();
    if (rest.endAt && Date.now() >= rest.endAt) restDone();
    const el = $("elapsed"); if (el && w) el.textContent = fmtClock(Date.now()-new Date(w.startTime));
    const fill = $("restFill"), time = $("restTime");
    if (fill && rest.total) fill.style.width = `${(1-restRemaining()/rest.total)*100}%`;
    if (time) time.textContent = fmtClock(restRemaining()*1000);
    const me = $("miniElapsed"); if (me && w) me.textContent = fmtClock(Date.now()-new Date(w.startTime));
    const mr = $("miniRest"); if (mr) mr.textContent = restRunning()?`⏱ ${fmtClock(restRemaining()*1000)}`:"";
  }, 500);

  /* =================== 更多 More =================== */
  function renderMore() {
    els.view.innerHTML = `<h1 class="page-title">更多</h1>
      <button class="list-item nav" id="mLibrary"><span class="li-title">動作庫（Exercise Library）</span><span class="li-sub">${FL.db.exercises.filter((e)=>!e.isArchived).length} 個動作 ›</span></button>
      <button class="list-item nav" id="mEquip"><span class="li-title">器材檔（Gym Equipment）</span><span class="li-sub">AI 排課依此 ›</span></button>
      <button class="list-item nav" id="mAI"><span class="li-title">AI 設定（API Key / 模型）</span><span class="li-sub">${FL.hasApiKey()?"已設定 ›":"未設定 ›"}</span></button>
      <button class="list-item nav" id="mPrefs"><span class="li-title">單位與計時</span><span class="li-sub">${FL.db.settings.unit} · 休息 ${FL.db.settings.restSeconds}s ›</span></button>
      <button class="list-item nav" id="mData"><span class="li-title">資料（備份 / 還原）</span><span class="li-sub">${FL.completedWorkouts().length} 場 ›</span></button>
      <div class="card" style="color:var(--text-2);font-size:12px;line-height:1.7;margin-top:14px">FitLog v2.0（Web）· 資料存在本裝置瀏覽器，請定期備份。</div>`;
    $("mLibrary").onclick = openLibrary;
    $("mEquip").onclick = openEquipment;
    $("mAI").onclick = openAISettings;
    $("mPrefs").onclick = openPrefs;
    $("mData").onclick = openDataSettings;
  }

  function openLibrary() {
    els.overlay.classList.remove("hidden");
    const render = (q, showArchived) => {
      let list = FL.db.exercises.filter((e) => showArchived || !e.isArchived);
      if (q) list = list.filter((e)=>e.nameZh.toLowerCase().includes(q)||e.nameEn.toLowerCase().includes(q));
      const body = Object.keys(MUSCLE_GROUPS).map((g) => {
        const inG = list.filter((e)=>e.muscleGroup===g); if (!inG.length) return "";
        return `<div class="group-header">${groupLabel(g)}</div>` + inG.map((e)=>`<button class="list-item" data-ex="${e.id}">
          <div class="li-row"><span><span class="li-title">${esc(e.nameZh)}</span>${e.isUnilateral?' <span class="uni-badge">單邊</span>':""}<span class="li-sub">　${esc(e.nameEn)}</span></span>
          <span class="li-sub">${e.isFavorite?"★":""}${e.isBlacklisted?"🚫":""}${e.isArchived?"📦":""}</span></div></button>`).join("");
      }).join("");
      $("libList").innerHTML = body;
      $("libList").querySelectorAll("[data-ex]").forEach((el)=>{ el.onclick = () => openExerciseDetail(el.dataset.ex); });
    };
    els.overlay.innerHTML = `<div class="ov-header"><button class="icon-btn" id="libBack">‹ 返回</button>
      <span class="ov-title">動作庫</span><button class="icon-btn accent" id="libNew">＋</button></div>
      <input class="search-input" id="libSearch" placeholder="搜尋動作…">
      <label class="check-line"><input type="checkbox" id="libArch"> 顯示已封存</label>
      <div id="libList"></div>`;
    $("libBack").onclick = () => { els.overlay.classList.add("hidden"); ui.renderTab(); };
    $("libNew").onclick = () => openExerciseEditor(null, () => render($("libSearch").value.trim().toLowerCase(), $("libArch").checked));
    $("libSearch").oninput = () => render($("libSearch").value.trim().toLowerCase(), $("libArch").checked);
    $("libArch").onchange = () => render($("libSearch").value.trim().toLowerCase(), $("libArch").checked);
    render("", false);
  }

  function openExerciseDetail(id) {
    const ex = exerciseById(id); if (!ex) return;
    const sets = FL.allSetsOf(id, null);
    const sessions = FL.sessionHistory(id);
    const maxW = FL.maxWeight(sets), e1rm = FL.bestE1RM(sets), maxSess = FL.maxSessionVolume(id), maxR = FL.maxReps(sets);
    const rm = FL.rmTable(e1rm);
    const unit = FL.db.settings.unit;
    const points = sessions.slice(0, 12).reverse().map((s)=>FL.maxWeight(s.sets)).filter((v)=>v!=null).map((kg)=>toDisplay(kg));
    let svg = "";
    if (points.length >= 2) {
      const min=Math.min(...points), max=Math.max(...points), range=max-min||1, W=320,H=130,pad=12;
      const c = points.map((v,i)=>[pad+(i*(W-2*pad))/(points.length-1), H-pad-((v-min)/range)*(H-2*pad)]);
      svg = `<div class="card"><div class="stat-title" style="margin-bottom:6px">重量趨勢（Weight Trend）· 各場最佳（${unit}）</div>
        <svg class="trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
          <polyline points="${c.map((p)=>p.join(",")).join(" ")}" fill="none" stroke="#4ADE80" stroke-width="2.5" stroke-linejoin="round"/>
          ${c.map((p)=>`<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#4ADE80"/>`).join("")}</svg></div>`;
    }
    els.overlay.classList.remove("hidden");
    els.overlay.innerHTML = `
      <div class="ov-header"><button class="icon-btn" id="xBack">‹ 返回</button>
        <span class="ov-title">${esc(ex.nameZh)}</span><button class="icon-btn" id="xEdit">編輯</button></div>
      <div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${muscleTag(ex.muscleGroup)}<span class="tag">${PATTERNS[ex.movementPattern]}</span>
        <span class="tag">${EQUIPMENT[ex.equipment]||""}</span>${ex.isUnilateral?'<span class="tag">單邊（Unilateral）</span>':""}</div>
      <div class="toggle-row">
        <button class="chip ${ex.isFavorite?"on":""}" id="xFav">★ 收藏</button>
        <button class="chip ${ex.isBlacklisted?"on danger":""}" id="xBlack">🚫 不推薦</button>
        <button class="chip ${ex.isUnilateral?"on":""}" id="xUni">單邊</button></div>
      <div class="stat-grid" style="grid-template-columns:1fr 1fr 1fr">
        <div class="card stat-card"><div class="stat-title">最大重量</div><div class="stat-value" style="font-size:20px">${maxW?trimNum(toDisplay(maxW)):"—"}</div><div class="stat-caption">${unit}</div></div>
        <div class="card stat-card"><div class="stat-title">估算 1RM</div><div class="stat-value" style="font-size:20px">${e1rm?trimNum(toDisplay(e1rm)):"—"}</div><div class="stat-caption">${unit}·估計</div></div>
        <div class="card stat-card"><div class="stat-title">最大單場量</div><div class="stat-value" style="font-size:16px">${maxSess?fmtVolume(maxSess):"—"}</div><div class="stat-caption">Volume</div></div></div>
      ${rm ? `<div class="card"><div class="stat-title" style="margin-bottom:8px">RM 估算表（Epley × Brzycki 平均，估計值）</div>
        <div class="rm-table">${rm.map((r)=>`<div class="rm-cell"><div class="rm-label">${r.rm}RM</div><div class="rm-val num">${trimNum(toDisplay(r.kg))}</div></div>`).join("")}</div></div>` : ""}
      ${svg}
      <h2 class="section-title">歷史（History）</h2>
      ${sessions.length ? sessions.map((s)=>`<div class="card">
        <div class="li-top"><span class="li-title">${fmtDate(s.date)}</span>
          <span class="li-sub num">${fmtVolume(s.sets.filter((x)=>x.setType!=="warmup").reduce((a,x)=>a+x.weightKg*x.reps*FL.unilateralMult(ex),0))}</span></div>
        <div class="sets-summary">${s.sets.map((x)=>`${trimNum(toDisplay(x.weightKg))}×${x.reps}`).join("　")}</div></div>`).join("")
        : `<div class="empty">還沒有紀錄——在訓練中加入這個動作後，歷史與 PR 會顯示在這裡。</div>`}
      <button class="btn btn-card" id="xArchive" style="margin-top:8px">${ex.isArchived?"取消封存":"封存（不刪除歷史）"}</button>`;
    $("xBack").onclick = () => { els.overlay.classList.add("hidden"); openLibrary(); };
    $("xEdit").onclick = () => openExerciseEditor(ex, () => openExerciseDetail(id));
    $("xFav").onclick = () => { ex.isFavorite = !ex.isFavorite; if (ex.isFavorite) ex.isBlacklisted=false; save(); openExerciseDetail(id); };
    $("xBlack").onclick = () => { ex.isBlacklisted = !ex.isBlacklisted; if (ex.isBlacklisted) ex.isFavorite=false; save(); openExerciseDetail(id); };
    $("xUni").onclick = () => { if (confirm(ex.isUnilateral?"取消單邊標記？Volume 將不再 ×2。":"標記為單邊動作？Volume 會以總次數 ×2 計（回溯套用歷史）。")) { ex.isUnilateral = !ex.isUnilateral; save(); openExerciseDetail(id); } };
    $("xArchive").onclick = () => { ex.isArchived = !ex.isArchived; save(); els.overlay.classList.add("hidden"); openLibrary(); };
  }

  function openExerciseEditor(ex, onDone) {
    const isNew = !ex;
    els.modal.classList.remove("hidden");
    els.modal.innerHTML = `<div class="modal-sheet">
      <div class="ov-header" style="position:static;background:none;padding:0 0 8px">
        <button class="icon-btn" id="eCancel">取消</button><span class="ov-title">${isNew?"新增動作":"編輯動作"}</span><button class="icon-btn accent" id="eSave">儲存</button></div>
      <div class="form-row"><label style="flex-shrink:0">中文名稱</label><input class="form-input" id="eZh" value="${esc(ex?.nameZh||"")}" placeholder="如：臥推"></div>
      <div class="form-row"><label style="flex-shrink:0">英文名稱</label><input class="form-input" id="eEn" value="${esc(ex?.nameEn||"")}" placeholder="如：Bench Press"></div>
      <div class="form-row"><label>肌群</label><select class="form-select" id="eGroup">${Object.keys(MUSCLE_GROUPS).map((g)=>`<option value="${g}" ${ex?.muscleGroup===g?"selected":""}>${groupLabel(g)}</option>`).join("")}</select></div>
      <div class="form-row"><label>動作模式</label><select class="form-select" id="ePattern">${Object.keys(PATTERNS).map((pp)=>`<option value="${pp}" ${ex?.movementPattern===pp?"selected":""}>${PATTERNS[pp]}</option>`).join("")}</select></div>
      <div class="form-row"><label>器材</label><select class="form-select" id="eEquip">${Object.keys(EQUIPMENT).map((q)=>`<option value="${q}" ${ex?.equipment===q?"selected":""}>${EQUIPMENT[q]}</option>`).join("")}</select></div>
      <div class="form-row"><label>自重動作</label><input type="checkbox" id="eBw" ${ex?.isBodyweight?"checked":""} style="width:20px;height:20px;accent-color:#4ADE80"></div>
      <div class="form-row" style="border-bottom:none"><label>單邊動作</label><input type="checkbox" id="eUni" ${ex?.isUnilateral?"checked":""} style="width:20px;height:20px;accent-color:#4ADE80"></div></div>`;
    $("eCancel").onclick = ui.closeModal;
    $("eSave").onclick = () => {
      const zh = $("eZh").value.trim(); if (!zh) return alert("請輸入中文名稱");
      const data = { nameZh: zh, nameEn: $("eEn").value.trim()||zh, muscleGroup: $("eGroup").value,
        movementPattern: $("ePattern").value, equipment: $("eEquip").value, isBodyweight: $("eBw").checked, isUnilateral: $("eUni").checked };
      if (isNew) FL.db.exercises.push({ id: uid(), ...data, isCustom:true, isFavorite:false, isBlacklisted:false, isArchived:false });
      else Object.assign(ex, data);
      save(); ui.closeModal(); onDone ? onDone() : ui.renderTab();
    };
  }

  function openEquipment() {
    const p = FL.db.settings.equipmentProfile;
    els.overlay.classList.remove("hidden");
    els.overlay.innerHTML = `<div class="ov-header"><button class="icon-btn" id="eqBack">‹ 返回</button><span class="ov-title">器材檔（Gym Equipment）</span><span style="width:52px"></span></div>
      <div class="card" style="color:var(--text-2);font-size:12.5px;line-height:1.7;margin-bottom:12px">勾選你的健身房有的器材，AI 排課只會推薦你能做的動作。</div>
      <div class="card">${Object.keys(EQUIPMENT).map((k)=>`<label class="form-row" style="cursor:pointer"><span>${EQUIPMENT[k]}</span>
        <input type="checkbox" data-eq="${k}" ${p[k]?"checked":""} style="width:22px;height:22px;accent-color:#4ADE80"></label>`).join("")}</div>`;
    $("eqBack").onclick = () => { els.overlay.classList.add("hidden"); ui.renderTab(); };
    els.overlay.querySelectorAll("[data-eq]").forEach((el)=>{ el.onchange = () => { p[el.dataset.eq] = el.checked; save(); }; });
  }

  function openAISettings() {
    const s = FL.db.settings;
    els.overlay.classList.remove("hidden");
    els.overlay.innerHTML = `<div class="ov-header"><button class="icon-btn" id="aiBack">‹ 返回</button><span class="ov-title">AI 設定</span><span style="width:52px"></span></div>
      <div class="card">
        <div class="form-row"><label style="flex-shrink:0">API Key</label><input class="form-input" type="password" id="aiKey" style="max-width:60%" placeholder="sk-ant-…" value="${esc(s.apiKey||"")}"></div>
        <div class="form-row"><label>AI 模型</label><select class="form-select" id="aiModel">${Object.entries(FL.CLAUDE_MODELS).map(([id,m])=>`<option value="${id}" ${s.model===id?"selected":""}>${m.name}</option>`).join("")}</select></div>
        <div class="form-row" style="border-bottom:none"><button class="btn-ghost btn" id="aiTest" style="width:auto;padding:9px 18px">測試連線</button><span class="hint" id="aiTestR"></span></div></div>
      <div class="card" style="color:var(--text-2);font-size:12.5px;line-height:1.7">${FL.CLAUDE_MODELS[s.model]?.hint||""}<br>Key 只存在本裝置、直連 Claude API。到 platform.claude.com 建立 Key，並建議設用量上限。匯出備份不會包含 Key。</div>`;
    $("aiBack").onclick = () => { els.overlay.classList.add("hidden"); ui.renderTab(); };
    $("aiKey").oninput = (e) => { s.apiKey = e.target.value.trim(); save(); };
    $("aiModel").onchange = (e) => { s.model = e.target.value; save(); openAISettings(); };
    $("aiTest").onclick = async (e) => {
      const r = $("aiTestR"); e.target.disabled = true; r.textContent = "測試中…"; r.style.color = "var(--text-2)";
      try { await FL.testKey(); r.textContent = "✓ 連線成功"; r.style.color = "var(--accent)"; }
      catch (err) { r.textContent = err.message; r.style.color = "var(--danger)"; }
      e.target.disabled = false;
    };
  }

  function openPrefs() {
    const s = FL.db.settings;
    els.overlay.classList.remove("hidden");
    els.overlay.innerHTML = `<div class="ov-header"><button class="icon-btn" id="prBack">‹ 返回</button><span class="ov-title">單位與計時</span><span style="width:52px"></span></div>
      <div class="card">
        <div class="form-row"><label>重量單位</label><div class="seg" id="segUnit"><button data-u="kg" class="${s.unit==="kg"?"on":""}">公斤 kg</button><button data-u="lb" class="${s.unit==="lb"?"on":""}">磅 lb</button></div></div>
        <div class="form-row"><label>預設目標（Goal）</label><select class="form-select" id="prGoal">${Object.entries(FL.GOALS).map(([k,v])=>`<option value="${k}" ${s.defaultGoal===k?"selected":""}>${v}</option>`).join("")}</select></div>
        <div class="form-row" style="border-bottom:none"><label>預設休息時間</label><div class="stepper"><button id="rM">−</button><span class="num">${s.restSeconds} 秒</span><button id="rP">＋</button></div></div></div>
      <div class="card" style="color:var(--text-2);font-size:12.5px;line-height:1.6">切換單位只影響顯示，歷史一律以 kg 儲存、自動換算。</div>`;
    $("prBack").onclick = () => { els.overlay.classList.add("hidden"); ui.renderTab(); };
    els.overlay.querySelectorAll("#segUnit button").forEach((b)=>{ b.onclick = () => { s.unit = b.dataset.u; save(); openPrefs(); }; });
    $("prGoal").onchange = (e) => { s.defaultGoal = e.target.value; save(); };
    $("rM").onclick = () => { s.restSeconds = Math.max(15, s.restSeconds-15); save(); openPrefs(); };
    $("rP").onclick = () => { s.restSeconds = Math.min(300, s.restSeconds+15); save(); openPrefs(); };
  }

  function openDataSettings() {
    els.overlay.classList.remove("hidden");
    els.overlay.innerHTML = `<div class="ov-header"><button class="icon-btn" id="dtBack">‹ 返回</button><span class="ov-title">資料</span><span style="width:52px"></span></div>
      <div class="card"><div class="form-row"><label>動作</label><span class="hint num">${FL.db.exercises.length}</span></div>
        <div class="form-row"><label>訓練紀錄</label><span class="hint num">${FL.completedWorkouts().length}</span></div>
        <div class="form-row" style="border-bottom:none"><label>AI 週報</label><span class="hint num">${FL.db.reports.length}</span></div></div>
      <button class="btn btn-card" id="expJson">匯出 JSON 備份（不含 Key）</button>
      <button class="btn btn-card" id="expCsv">匯出 CSV（試算表）</button>
      <button class="btn btn-card" id="impJson">匯入 JSON（還原備份）</button>
      <input type="file" id="impFile" accept=".json" style="display:none">
      <div class="card" style="color:var(--text-2);font-size:12.5px;line-height:1.7;margin-top:12px">⚠️ 資料只存在本裝置瀏覽器。清除瀏覽器資料會全部消失——請定期匯出備份。加到主畫面可離線使用且更不易被清除。</div>`;
    $("dtBack").onclick = () => { els.overlay.classList.add("hidden"); ui.renderTab(); };
    $("expJson").onclick = exportJSON;
    $("expCsv").onclick = exportCSV;
    $("impJson").onclick = () => $("impFile").click();
    $("impFile").onchange = importJSON;
  }

  function download(filename, text, mime) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename; a.click(); URL.revokeObjectURL(a.href);
  }
  function today() { return FL.localDateKey(new Date().toISOString()); }
  function exportJSON() { download(`fitlog-backup-${today()}.json`, JSON.stringify(FL.exportData(), null, 2), "application/json"); ui.showToast("✓ 已匯出（不含 API Key）"); }
  function exportCSV() {
    const rows = [["date","exercise_zh","exercise_en","muscle_group","unilateral","set_index","weight_kg","reps","set_type"]];
    for (const w of FL.completedWorkouts())
      for (const en of w.entries) { const ex = exerciseById(en.exerciseId);
        en.sets.forEach((s,i)=>{ if (!s.completedAt) return; rows.push([w.startTime.slice(0,10), ex?.nameZh||"", ex?.nameEn||"", ex?.muscleGroup||"", ex?.isUnilateral?1:0, i+1, s.weightKg, s.reps, s.setType]); }); }
    const csv = "﻿" + rows.map((r)=>r.map((c)=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    download(`fitlog-${today()}.csv`, csv, "text/csv");
  }
  function importJSON(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.exercises || !data.workouts) throw new Error();
        if (confirm(`將以備份取代目前資料（${data.workouts.length} 筆訓練）。目前的 API Key 會保留。確定？`)) {
          const keepKey = FL.db.settings.apiKey;
          FL.replaceDB(data);
          if (!FL.db.settings.apiKey && keepKey) { FL.db.settings.apiKey = keepKey; save(); }
          els.overlay.classList.add("hidden"); ui.renderTab(); ui.renderMiniBar(); ui.showToast("✓ 已還原備份");
        }
      } catch (_) { alert("檔案格式不正確"); }
    };
    reader.readAsText(file); e.target.value = "";
  }

  ui.groupLabel = groupLabel;
  ui.muscleTag = muscleTag;
})(window.FL);
