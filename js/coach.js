/* =====================================================================
   FitLog v2 — AI 教練分頁（排課）＋ 週報渲染
   排課結果的「換一個」用預先回傳的替代動作，零額外 API 呼叫。
   ===================================================================== */
"use strict";
window.FL = window.FL || {};

(function (FL) {
  const ui = FL.ui;
  const $ = (id) => document.getElementById(id);
  const { esc, MUSCLE_GROUPS, GOALS, BODY_STATES, fmtWeight, trimNum, toDisplay, exerciseById, save, uid } = FL;

  // 排課輸入狀態
  let form = null;
  function defaultForm() {
    return { minutes: 60, goal: FL.db.settings.defaultGoal || "hypertrophy", muscleMode: "ai", groups: [], bodyState: "normal", freeText: "" };
  }

  /* =================== AI 教練分頁 =================== */
  ui.renderCoach = function () {
    if (!form) form = defaultForm();
    const el = ui.els.view;
    el.innerHTML = `<h1 class="page-title">AI 教練</h1>
      ${!FL.hasApiKey() ? `<div class="card" style="color:var(--text-2);font-size:13px;line-height:1.7">尚未設定 API Key——到「更多 → AI 設定」貼上你的 Claude API Key 即可使用排課與分析。</div>` : ""}
      <div class="card">
        <div class="coach-label">訓練時間</div>
        <div class="seg" id="cMin">${[30,45,60,90].map((m)=>`<button data-min="${m}" class="${form.minutes===m?"on":""}">${m}分</button>`).join("")}</div>
        <div class="coach-label">目標（Goal）</div>
        <select class="form-select full" id="cGoal">${Object.entries(GOALS).map(([k,v])=>`<option value="${k}" ${form.goal===k?"selected":""}>${v}</option>`).join("")}</select>
        <div class="coach-label">訓練肌群</div>
        <div class="seg" id="cMuscleMode">
          <button data-mm="ai" class="${form.muscleMode==="ai"?"on":""}">AI 決定</button>
          <button data-mm="pick" class="${form.muscleMode==="pick"?"on":""}">指定肌群</button></div>
        <div id="cGroups" class="chip-wrap ${form.muscleMode==="pick"?"":"hidden"}">
          ${Object.keys(MUSCLE_GROUPS).filter((g)=>g!=="cardio").map((g)=>`<button class="chip ${form.groups.includes(g)?"on":""}" data-g="${g}">${MUSCLE_GROUPS[g].zh}</button>`).join("")}</div>
        <div class="coach-label">身體狀況</div>
        <div class="seg" id="cBody">${Object.entries(BODY_STATES).map(([k,v])=>`<button data-b="${k}" class="${form.bodyState===k?"on":""}">${v}</button>`).join("")}</div>
        <div class="coach-label">補充（可選）</div>
        <textarea class="form-input full" id="cNote" rows="2" placeholder="例如：今天肩膀不太舒服、想多練背…">${esc(form.freeText)}</textarea>
      </div>
      <button class="btn btn-primary" id="cGen">✦ 產生今日課表</button>`;

    el.querySelectorAll("#cMin button").forEach((b)=>{ b.onclick = () => { form.minutes = +b.dataset.min; ui.renderCoach(); }; });
    $("cGoal").onchange = (e) => { form.goal = e.target.value; };
    el.querySelectorAll("#cMuscleMode button").forEach((b)=>{ b.onclick = () => { form.muscleMode = b.dataset.mm; ui.renderCoach(); }; });
    el.querySelectorAll("#cGroups button").forEach((b)=>{ b.onclick = () => { const g=b.dataset.g; form.groups = form.groups.includes(g)?form.groups.filter((x)=>x!==g):[...form.groups,g]; ui.renderCoach(); }; });
    el.querySelectorAll("#cBody button").forEach((b)=>{ b.onclick = () => { form.bodyState = b.dataset.b; ui.renderCoach(); }; });
    $("cNote").oninput = (e) => { form.freeText = e.target.value; };
    $("cGen").onclick = (e) => generatePlan(e.target);
    ui.renderMiniBar();
  };

  async function generatePlan(btn) {
    if (!FL.hasApiKey()) { alert("請先到「更多 → AI 設定」輸入 Claude API Key。"); return; }
    if (form.muscleMode === "pick" && !form.groups.length) { alert("請至少選一個肌群，或改用「AI 決定」。"); return; }
    const input = { minutes: form.minutes, goal: form.goal, bodyState: form.bodyState, freeText: form.freeText,
      muscleMode: form.muscleMode === "pick" ? form.groups : "ai" };
    const orig = btn.textContent; btn.disabled = true; btn.textContent = "✦ 排課中…（約 20–40 秒）";
    try {
      const res = await FL.generatePlan(input);
      openPlanResult(res.content, res.usage);
    } catch (err) { alert(`排課失敗：${err.message}`); }
    finally { btn.disabled = false; btn.textContent = orig; }
  }

  // 課表結果（含換一個、一鍵建立）
  function openPlanResult(plan, usage) {
    // 每個動作的候選池 = [目前, ...替代]；swapIdx 追蹤
    const items = plan.exercises.map((ex) => {
      const pool = [{ exercise_id: ex.exercise_id, name_zh: ex.name_zh, name_en: ex.name_en, sets: ex.sets, reps: ex.reps, suggested_weight_kg: ex.suggested_weight_kg, rationale: ex.rationale }];
      for (const alt of ex.alternatives || []) {
        const w = suggestWeightFor(alt.exercise_id);
        pool.push({ exercise_id: alt.exercise_id, name_zh: alt.name_zh, name_en: alt.name_en, sets: ex.sets, reps: ex.reps, suggested_weight_kg: w, rationale: alt.reason });
      }
      return { pool, idx: 0 };
    });
    ui.currentPlanItems = items;

    const el = ui.els.overlay;
    el.classList.remove("hidden");
    const render = () => {
      el.innerHTML = `<div class="ov-header"><button class="icon-btn" id="pBack">‹ 返回</button>
        <span class="ov-title">今日課表</span><span style="width:52px"></span></div>
        <div class="card headline-card">${esc(plan.focus_summary||"")}</div>
        ${(plan.warnings&&plan.warnings.length)?`<div class="card warn-card">${plan.warnings.map((w)=>`⚠️ ${esc(w)}`).join("<br>")}</div>`:""}
        <div class="hint" style="padding:2px 4px 10px">預估 ${plan.estimated_minutes||form.minutes} 分鐘 · ${esc(plan.progression_note||"")}</div>
        ${items.map((it,i)=>{ const c=it.pool[it.idx]; const ex=exerciseById(c.exercise_id);
          return `<div class="card plan-item">
            <div class="ex-header"><span class="ex-name">${i+1}. ${esc(c.name_zh)}${ex&&ex.isUnilateral?' <span class="uni-badge">單邊</span>':""}<small>${esc(c.name_en)}</small></span>
              ${ex?ui.muscleTag(ex.muscleGroup,true):""}</div>
            <div class="plan-spec num">${c.sets} 組 × ${esc(String(c.reps))} 次${c.suggested_weight_kg?` · 建議 ${fmtWeight(c.suggested_weight_kg)}`:""}</div>
            <p class="rep-text">${esc(c.rationale||"")}</p>
            ${it.pool.length>1?`<button class="btn-ghost btn swap-btn" data-swap="${i}">↻ 換一個（${it.idx+1}/${it.pool.length}）</button>`:""}</div>`;
        }).join("")}
        <button class="btn btn-primary" id="pCreate">＋ 一鍵建立今日 Workout</button>
        <button class="btn btn-card" id="pRegen">重新排課</button>
        <div class="card" style="color:var(--text-2);font-size:12px">tokens ${(usage.input_tokens||0).toLocaleString()} in / ${(usage.output_tokens||0).toLocaleString()} out · 「換一個」不需再呼叫 AI</div>`;
      $("pBack").onclick = () => { el.classList.add("hidden"); ui.renderTab(); };
      $("pRegen").onclick = () => { el.classList.add("hidden"); ui.renderTab(); };
      $("pCreate").onclick = () => {
        const chosen = { exercises: items.map((it)=>{ const c=it.pool[it.idx]; return { exercise_id: c.exercise_id, name_zh: c.name_zh, name_en: c.name_en, sets: c.sets, reps: c.reps, suggested_weight_kg: c.suggested_weight_kg }; }) };
        el.classList.add("hidden");
        ui.startWorkoutFromPlan(chosen);
      };
      el.querySelectorAll("[data-swap]").forEach((b)=>{ b.onclick = () => { const i=+b.dataset.swap; items[i].idx = (items[i].idx+1)%items[i].pool.length; render(); }; });
    };
    render();
  }

  // 依本地歷史估建議重量（換動作時用，零 API）
  function suggestWeightFor(exId) {
    const last = FL.lastPerformance(exId, null);
    if (last && last.sets.length) return last.sets[last.sets.length-1].weightKg || null;
    return null;
  }

  /* =================== 週報（Dashboard 區塊 + 檢視）=================== */
  ui.aiReportSectionHTML = function () {
    const reports = [...FL.db.reports].sort((a,b)=>b.weekStart.localeCompare(a.weekStart));
    return `<h2 class="section-title">AI 教練分析（Weekly Report）</h2>
      <button class="btn btn-primary" id="aiGenNow">✦ 產生本週分析</button>
      <button class="btn btn-card" id="aiGenPrev">產生上週分析</button>
      ${!FL.hasApiKey()?`<div class="card" style="margin-top:10px;color:var(--text-2);font-size:12.5px;line-height:1.7">尚未設定 API Key——到「更多 → AI 設定」貼上即可使用。</div>`:""}
      ${reports.length?`<div style="margin-top:10px">`+reports.map((r)=>`<button class="list-item" data-report="${r.id}">
        <div class="li-top"><span class="li-title">週報 ${r.weekStart}</span><span class="li-sub">${FL.CLAUDE_MODELS[r.model]?.short||r.model}</span></div>
        <div class="li-sub">${esc(r.content?.headline||"")}</div></button>`).join("")+`</div>`:""}`;
  };
  ui.bindAiReportSection = function (root) {
    const gn = root.querySelector("#aiGenNow"); if (gn) gn.onclick = () => genReport(new Date(), gn);
    const gp = root.querySelector("#aiGenPrev"); if (gp) gp.onclick = () => { const d=new Date(); d.setDate(d.getDate()-7); genReport(d, gp); };
    root.querySelectorAll("[data-report]").forEach((el)=>{ el.onclick = () => openReport(el.dataset.report); });
  };

  async function genReport(refDate, btn) {
    if (!FL.hasApiKey()) { alert("請先到「更多 → AI 設定」輸入 Claude API Key。"); return; }
    const orig = btn.textContent; btn.disabled = true; btn.textContent = "✦ 分析中…（約 30 秒）";
    try {
      const res = await FL.generateWeeklyReport(refDate);
      FL.db.reports = FL.db.reports.filter((r)=>r.weekStart!==res.weekStart);
      const report = { id: uid(), weekStart: res.weekStart, generatedAt: new Date().toISOString(),
        model: FL.db.settings.model, content: res.content, inputTokens: res.usage.input_tokens||0, outputTokens: res.usage.output_tokens||0 };
      FL.db.reports.push(report); save();
      openReport(report.id);
    } catch (err) { alert(`產生失敗：${err.message}`); }
    finally { btn.disabled = false; btn.textContent = orig; if (ui.els.overlay.classList.contains("hidden")) ui.renderTab(); }
  }

  function repList(label, arr, mapFn) {
    if (!arr || !arr.length) return "";
    const items = mapFn ? arr.map(mapFn) : arr;
    return `<div class="rep-list"><span class="rep-list-label">${label}</span>${items.map((x)=>`<span class="tag">${esc(x)}</span>`).join("")}</div>`;
  }
  function openReport(id) {
    const r = FL.db.reports.find((x)=>x.id===id); if (!r) return;
    const c = r.content || {};
    const trendLabel = { increasing:"↑ 上升", stable:"→ 持平", decreasing:"↓ 下降" };
    const riskMeta = { good:["狀態良好","risk-good"], caution:["需要留意","risk-caution"], warning:["警示","risk-warning"] };
    const catLabel = { training:"訓練", recovery:"恢復", exercise_swap:"動作替代", balance:"平衡" };
    const gZh = (g)=>MUSCLE_GROUPS[g]?`${MUSCLE_GROUPS[g].zh}（${MUSCLE_GROUPS[g].en}）`:g;
    const risk = riskMeta[c.recovery_analysis?.risk_level]||["",""];
    // 向後相容：舊報告用 progression_analysis（stalled→plateaued）
    const strength = c.strength_progress || (c.progression_analysis ? {
      summary: c.progression_analysis.summary,
      progressing_exercises: c.progression_analysis.progressing_exercises,
      plateaued_exercises: c.progression_analysis.stalled_exercises,
    } : {});
    const el = ui.els.overlay; el.classList.remove("hidden");
    el.innerHTML = `<div class="ov-header"><button class="icon-btn" id="rBack">‹ 返回</button>
        <span class="ov-title">週報 ${r.weekStart}</span><button class="icon-btn danger" id="rDel">刪除</button></div>
      <div class="card headline-card">${esc(c.headline||"")}</div>
      <div class="card"><div class="rep-head">訓練量分析（Volume）<span class="tag">${trendLabel[c.volume_analysis?.trend]||""}</span></div>
        <p class="rep-text">${esc(c.volume_analysis?.summary||"")}</p>
        ${repList("提升", c.volume_analysis?.increased_groups, gZh)}${repList("下降", c.volume_analysis?.decreased_groups, gZh)}</div>
      <div class="card"><div class="rep-head">恢復分析（Recovery）<span class="risk-badge ${risk[1]}">${risk[0]}</span></div>
        <p class="rep-text">${esc(c.recovery_analysis?.summary||"")}</p></div>
      <div class="card"><div class="rep-head">平衡分析（Balance）<span class="tag num">推拉比 ${c.balance_analysis?.push_pull_ratio??"—"}</span></div>
        <p class="rep-text">${esc(c.balance_analysis?.summary||"")}</p></div>
      <div class="card"><div class="rep-head">力量進展（Strength Progress）</div>
        <p class="rep-text">${esc(strength.summary||"")}</p>
        ${repList("進步中", strength.progressing_exercises)}${repList("平台期", strength.plateaued_exercises)}</div>
      ${c.weak_point?`<div class="card weak-card"><div class="rep-head">弱點（Weak Point）· ${esc(c.weak_point.title||"")}</div>
        <p class="rep-text">${esc(c.weak_point.summary||"")}</p></div>`:""}
      <h2 class="section-title">下週建議（Next Week）</h2>
      ${(c.suggestions||[]).map((s)=>`<div class="card"><div class="rep-head"><span class="tag" style="color:var(--accent)">${catLabel[s.category]||s.category}</span>${esc(s.title)}</div>
        <p class="rep-text">${esc(s.detail)}</p></div>`).join("")}
      <div class="card" style="color:var(--text-2);font-size:12px">模型 ${FL.CLAUDE_MODELS[r.model]?.short||r.model} · tokens ${r.inputTokens.toLocaleString()} in / ${r.outputTokens.toLocaleString()} out · ${new Date(r.generatedAt).toLocaleString("zh-TW")}</div>`;
    $("rBack").onclick = () => { el.classList.add("hidden"); ui.renderTab(); };
    $("rDel").onclick = () => { if (confirm("刪除這份週報？")) { FL.db.reports = FL.db.reports.filter((x)=>x.id!==id); save(); el.classList.add("hidden"); ui.renderTab(); } };
  }
  ui.openReport = openReport;
})(window.FL);
