/* =====================================================================
   FitLog v3 — 身體目標、InBody、進度照片（IndexedDB）與多模態 AI 分析
   原始照片不進 localStorage；送出前縮圖並移除 EXIF。
   ===================================================================== */
"use strict";
window.FL = window.FL || {};

(function (FL) {
  const ui = FL.ui;
  const $ = (id) => document.getElementById(id);
  const { esc, save, uid, fmtVolume, MUSCLE_GROUPS } = FL;
  const DB_NAME = "fitlog.body.v1";
  const STORE = "photos";
  let previewUrls = [];

  function openPhotoDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("date", "date");
        store.createIndex("kind", "kind");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function photoTx(mode, action) {
    const db = await openPhotoDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = action(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  const listPhotos = async () => (await photoTx("readonly", (s) => s.getAll()))
    .sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
  const getPhoto = (id) => photoTx("readonly", (s) => s.get(id));
  const deletePhoto = (id) => photoTx("readwrite", (s) => s.delete(id));
  const storePhoto = (photo) => photoTx("readwrite", (s) => s.put(photo));

  function localDate() { return FL.localDateKey(new Date().toISOString()); }
  function numOrNull(value) { const n = Number(value); return value === "" || !Number.isFinite(n) ? null : n; }
  function metric(value, unit, digits) {
    if (value == null) return "—";
    return `${Number(value).toFixed(digits ?? 1).replace(/\.0$/, "")} ${unit || ""}`.trim();
  }

  async function compressImage(file, maxSide, quality) {
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url;
      });
      const scale = Math.min(1, (maxSide || 1600) / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("照片處理失敗")), "image/jpeg", quality || 0.82
      ));
    } finally { URL.revokeObjectURL(url); }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
    });
  }

  function latestBodyRecord() {
    return [...FL.db.bodyRecords].sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  }

  function goalLabel(type) {
    return { muscle: "增肌", fatloss: "減脂", recomposition: "體態重組", strength: "力量提升" }[type] || "體態重組";
  }

  ui.renderBody = async function () {
    const el = ui.els.view;
    el.innerHTML = `<div class="page-loading"><span class="pulse-dot"></span>讀取本機身體資料…</div>`;
    let photos = [];
    try { photos = await listPhotos(); } catch (_) {}
    if (ui.currentTab !== "body") return;
    previewUrls.forEach(URL.revokeObjectURL); previewUrls = [];
    const progressPhotos = photos.filter((p) => p.kind === "progress");
    const latest = latestBodyRecord();
    const goal = FL.db.settings.bodyGoal || {};
    const analysis = [...FL.db.bodyAnalyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const photoCards = progressPhotos.slice(0, 9).map((p) => {
      const url = URL.createObjectURL(p.blob); previewUrls.push(url);
      const angle = { front: "正面", side: "側面", back: "背面" }[p.angle] || "進度";
      return `<article class="photo-card"><img src="${url}" alt="${angle}進度照片">
        <div class="photo-meta"><span>${angle}</span><span class="num">${esc(p.date)}</span></div>
        <button class="photo-delete" data-del-photo="${p.id}" aria-label="刪除照片">×</button></article>`;
    }).join("");

    el.innerHTML = `<div class="page-kicker">BODY INTELLIGENCE</div>
      <div class="page-head-row"><div><h1 class="page-title">身體與目標</h1><p class="page-subtitle">照片留在本機；只有你確認分析時才會傳送。</p></div>
        <button class="icon-action" id="bodyGoalEdit" aria-label="編輯目標">⌁</button></div>
      <section class="goal-hero">
        <div><span class="signal-label">ACTIVE GOAL</span><h2>${goalLabel(goal.type)}</h2>
          <p>${goal.targetDate ? `目標日 ${esc(goal.targetDate)}` : "設定數字目標，讓 AI 建議更精準"}</p></div>
        <div class="goal-target"><span>${metric(goal.targetWeightKg, "kg")}</span><small>目標體重</small></div>
      </section>

      <div class="action-grid body-actions">
        <button class="action-tile" id="bodyAddPhoto"><span class="action-icon">＋</span><strong>進度照片</strong><small>正面／側面／背面</small></button>
        <button class="action-tile" id="bodyAddInbody"><span class="action-icon scan">▣</span><strong>掃描 InBody</strong><small>AI 辨識後確認數值</small></button>
      </div>

      <h2 class="section-title">最新身體組成</h2>
      ${latest ? `<div class="metric-strip">
        <div><span>${metric(latest.weightKg,"kg")}</span><small>體重</small></div>
        <div><span>${metric(latest.skeletalMuscleKg,"kg")}</span><small>骨骼肌</small></div>
        <div><span>${metric(latest.bodyFatPct,"%")}</span><small>體脂率</small></div>
        <div><span>${metric(latest.visceralFat,"級",0)}</span><small>內臟脂肪</small></div></div>
        <div class="hint data-stamp">資料日期 ${esc(latest.date)} · ${latest.source === "scan" ? "AI 掃描後確認" : "手動輸入"}</div>`
        : `<div class="empty-state compact"><span class="empty-orbit"></span><strong>尚未建立身體基準</strong><p>掃描一張 InBody 報告，或手動輸入數值。</p></div>`}

      <div class="section-head"><h2 class="section-title">AI 身體分析</h2>${analysis ? `<span class="provider-badge">${esc(analysis.provider || "AI")}</span>` : ""}</div>
      ${analysis ? analysisHTML(analysis.content) : `<div class="card intelligence-card"><span class="signal-label">MULTIMODAL</span>
        <h3>把照片、InBody 與訓練紀錄放在同一份報告</h3><p>AI 會分開標示觀察、數據證據與可執行建議，不會只靠照片猜精確體脂。</p></div>`}
      <button class="btn btn-primary ai-analyze-btn" id="bodyAnalyze" ${(!latest && !progressPhotos.length) ? "disabled" : ""}>✦ 產生綜合分析</button>

      <div class="section-head"><h2 class="section-title">進度照片</h2><span class="hint">${progressPhotos.length} 張 · 本機</span></div>
      ${photoCards ? `<div class="photo-grid">${photoCards}</div>` : `<div class="empty-state compact"><strong>還沒有照片</strong><p>固定光線與角度，長期比較才有意義。</p></div>`}`;

    $("bodyGoalEdit").onclick = openGoalModal;
    $("bodyAddPhoto").onclick = openProgressPhotoModal;
    $("bodyAddInbody").onclick = openInBodyModal;
    $("bodyAnalyze").onclick = openAnalyzeConsent;
    el.querySelectorAll("[data-del-photo]").forEach((button) => {
      button.onclick = async () => {
        if (!confirm("刪除這張本機照片？此動作無法復原。")) return;
        await deletePhoto(button.dataset.delPhoto); ui.renderBody();
      };
    });
    ui.renderMiniBar();
  };

  function analysisHTML(content) {
    const c = content || {};
    return `<div class="card intelligence-card result"><span class="signal-label">LATEST ANALYSIS · ${esc(c.confidence || "資料有限")}</span>
      <h3>${esc(c.headline || "身體趨勢分析")}</h3>
      <p>${esc(c.training_alignment || "")}</p>
      ${(c.observations || []).length ? `<ul class="observation-list">${c.observations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${(c.evidence || []).length ? `<div class="evidence-list">${c.evidence.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
      ${(c.recommendations || []).length ? `<ol class="recommend-list">${c.recommendations.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
      ${(c.cautions || []).length ? `<div class="analysis-caution">${c.cautions.map(esc).join("<br>")}</div>` : ""}</div>`;
  }

  function openGoalModal() {
    const goal = FL.db.settings.bodyGoal || {};
    ui.els.modal.classList.remove("hidden");
    ui.els.modal.innerHTML = `<div class="modal-sheet"><div class="ov-header static-head">
      <button class="icon-btn" id="goalCancel">取消</button><span class="ov-title">身體目標</span><button class="icon-btn accent" id="goalSave">儲存</button></div>
      <div class="card form-card">
        <div class="form-row"><label>目標</label><select class="form-select" id="goalType">
          ${[["muscle","增肌"],["fatloss","減脂"],["recomposition","體態重組"],["strength","力量提升"]].map(([k,v]) => `<option value="${k}" ${goal.type===k?"selected":""}>${v}</option>`).join("")}</select></div>
        ${numberRow("goalWeight","目標體重","kg",goal.targetWeightKg)}
        ${numberRow("goalFat","目標體脂","%",goal.targetBodyFatPct)}
        ${numberRow("goalMuscle","目標骨骼肌","kg",goal.targetMuscleKg)}
        <div class="form-row no-border"><label>目標日期</label><input class="form-input inline-input" type="date" id="goalDate" value="${esc(goal.targetDate||"")}"></div>
      </div></div>`;
    $("goalCancel").onclick = ui.closeModal;
    $("goalSave").onclick = () => {
      FL.db.settings.bodyGoal = {
        type: $("goalType").value, targetWeightKg: numOrNull($("goalWeight").value),
        targetBodyFatPct: numOrNull($("goalFat").value), targetMuscleKg: numOrNull($("goalMuscle").value),
        targetDate: $("goalDate").value || null,
      };
      save(); ui.closeModal(); ui.renderBody();
    };
  }

  function numberRow(id, label, unit, value) {
    return `<div class="form-row"><label>${label}</label><div class="inline-unit"><input class="form-input" type="number" inputmode="decimal" step="0.1" id="${id}" value="${value ?? ""}"><span>${unit}</span></div></div>`;
  }

  function openProgressPhotoModal() {
    ui.els.modal.classList.remove("hidden");
    ui.els.modal.innerHTML = `<div class="modal-sheet"><div class="ov-header static-head">
      <button class="icon-btn" id="photoCancel">取消</button><span class="ov-title">新增進度照片</span><button class="icon-btn accent" id="photoSave">儲存</button></div>
      <div class="privacy-callout"><span>LOCAL ONLY</span>照片會縮小並移除相片定位資訊，原始檔不會放進訓練備份。</div>
      <div class="card form-card"><div class="form-row"><label>日期</label><input class="form-input inline-input" id="photoDate" type="date" value="${localDate()}"></div>
        <div class="form-row"><label>角度</label><select class="form-select" id="photoAngle"><option value="front">正面</option><option value="side">側面</option><option value="back">背面</option></select></div>
        <div class="form-row no-border"><label>照片</label><input type="file" id="photoFile" accept="image/jpeg,image/png,image/webp" capture="environment"></div></div></div>`;
    $("photoCancel").onclick = ui.closeModal;
    $("photoSave").onclick = async (event) => {
      const file = $("photoFile").files[0]; if (!file) return alert("請選擇照片");
      event.target.disabled = true; event.target.textContent = "處理中…";
      try {
        const blob = await compressImage(file, 1600, 0.82);
        await storePhoto({ id: uid(), kind: "progress", angle: $("photoAngle").value, date: $("photoDate").value || localDate(), blob, createdAt: new Date().toISOString() });
        ui.closeModal(); ui.renderBody(); ui.showToast("✓ 照片已存到本機");
      } catch (error) { alert(error.message || "照片處理失敗"); event.target.disabled = false; }
    };
  }

  const INBODY_SCHEMA = {
    type: "object", additionalProperties: false,
    required: ["scan_date","weight_kg","skeletal_muscle_kg","body_fat_pct","fat_mass_kg","bmi","visceral_fat","bmr_kcal","notes"],
    properties: {
      scan_date: { type: ["string","null"] }, weight_kg: { type: ["number","null"] },
      skeletal_muscle_kg: { type: ["number","null"] }, body_fat_pct: { type: ["number","null"] },
      fat_mass_kg: { type: ["number","null"] }, bmi: { type: ["number","null"] },
      visceral_fat: { type: ["number","null"] }, bmr_kcal: { type: ["number","null"] },
      notes: { type: "array", items: { type: "string" } },
    },
  };
  const INBODY_SYSTEM = `你是 InBody 報告資料擷取助手。只讀取圖片中清楚可見的數字，不猜測；不確定就回傳 null。日期用 YYYY-MM-DD。只做資料擷取，不提供醫療診斷。`;

  function openInBodyModal() {
    ui.els.modal.classList.remove("hidden");
    ui.els.modal.innerHTML = `<div class="modal-sheet"><div class="ov-header static-head">
      <button class="icon-btn" id="ibCancel">取消</button><span class="ov-title">新增 InBody</span><button class="icon-btn accent" id="ibSave">儲存</button></div>
      <div class="privacy-callout"><span>REVIEW FIRST</span>可先讓 AI 讀取報告；辨識結果必須由你確認後才會存入紀錄。</div>
      <div class="card form-card"><div class="form-row"><label>InBody 圖片</label><input type="file" id="ibFile" accept="image/*" aria-label="拍照或從相簿選擇 InBody 圖片"></div>
        <div class="upload-source-hint">可直接拍照，也可從相簿或檔案選擇既有圖片。</div>
        <button class="btn btn-card scan-btn" id="ibScan">▣ AI 讀取報告</button><div class="hint" id="ibStatus"></div>
        <div class="form-row"><label>日期</label><input class="form-input inline-input" id="ibDate" type="date" value="${localDate()}"></div>
        ${numberRow("ibWeight","體重","kg",null)}${numberRow("ibMuscle","骨骼肌","kg",null)}
        ${numberRow("ibFatPct","體脂率","%",null)}${numberRow("ibFatMass","脂肪量","kg",null)}
        ${numberRow("ibBMI","BMI","",null)}${numberRow("ibVisceral","內臟脂肪","級",null)}
        ${numberRow("ibBMR","基礎代謝","kcal",null)}
        <div class="form-row no-border"><label>備註</label><input class="form-input inline-input wide" id="ibNotes" placeholder="選填"></div></div></div>`;
    let scanBlob = null;
    $("ibCancel").onclick = ui.closeModal;
    $("ibFile").onchange = () => {
      const file = $("ibFile").files[0];
      scanBlob = null;
      $("ibStatus").textContent = file ? `已選擇：${file.name || "InBody 圖片"}` : "";
    };
    $("ibScan").onclick = async (event) => {
      const file = $("ibFile").files[0]; if (!file) return alert("請先選擇 InBody 報告照片");
      if (!FL.hasApiKey()) return alert("請先到「更多 → AI 設定」輸入 API Key。");
      event.target.disabled = true; $("ibStatus").textContent = "AI 辨識中…";
      try {
        scanBlob = await compressImage(file, 1800, 0.86);
        const image = await blobToDataUrl(scanBlob);
        const result = await FL.structured(INBODY_SYSTEM, "擷取這張 InBody 報告的欄位。", INBODY_SCHEMA, null, 2500, { images: [image] });
        const c = result.content;
        $("ibDate").value = /^\d{4}-\d{2}-\d{2}$/.test(c.scan_date || "") ? c.scan_date : $("ibDate").value;
        [["ibWeight",c.weight_kg],["ibMuscle",c.skeletal_muscle_kg],["ibFatPct",c.body_fat_pct],["ibFatMass",c.fat_mass_kg],["ibBMI",c.bmi],["ibVisceral",c.visceral_fat],["ibBMR",c.bmr_kcal]].forEach(([id,v]) => { if (v != null) $(id).value = v; });
        $("ibNotes").value = (c.notes || []).join("；");
        $("ibStatus").textContent = `✓ 已辨識，請逐項確認 · ${FL.aiModelLabel(result.model)}`;
      } catch (error) { $("ibStatus").textContent = error.message; }
      event.target.disabled = false;
    };
    $("ibSave").onclick = async () => {
      const file = $("ibFile").files[0];
      if (!scanBlob && file) scanBlob = await compressImage(file, 1800, 0.86);
      let scanPhotoId = null;
      if (scanBlob) {
        scanPhotoId = uid();
        await storePhoto({ id: scanPhotoId, kind: "inbody", angle: "report", date: $("ibDate").value || localDate(), blob: scanBlob, createdAt: new Date().toISOString() });
      }
      FL.db.bodyRecords.push({
        id: uid(), date: $("ibDate").value || localDate(), weightKg: numOrNull($("ibWeight").value),
        skeletalMuscleKg: numOrNull($("ibMuscle").value), bodyFatPct: numOrNull($("ibFatPct").value),
        fatMassKg: numOrNull($("ibFatMass").value), bmi: numOrNull($("ibBMI").value),
        visceralFat: numOrNull($("ibVisceral").value), bmrKcal: numOrNull($("ibBMR").value),
        notes: $("ibNotes").value.trim(), source: scanBlob ? "scan" : "manual", scanPhotoId,
      });
      save(); ui.closeModal(); ui.renderBody(); ui.showToast("✓ InBody 已儲存");
    };
  }

  const BODY_SCHEMA = {
    type: "object", additionalProperties: false,
    required: ["headline","observations","evidence","training_alignment","recommendations","confidence","cautions"],
    properties: {
      headline: { type: "string" }, observations: { type: "array", items: { type: "string" } },
      evidence: { type: "array", items: { type: "string" } }, training_alignment: { type: "string" },
      recommendations: { type: "array", items: { type: "string" }, maxItems: 5 },
      confidence: { type: "string", enum: ["高","中","低"] }, cautions: { type: "array", items: { type: "string" } },
    },
  };
  const BODY_SYSTEM = `你是運動表現與身體組成分析助手。請使用繁體中文，整合使用者確認過的 InBody 數字、目標、訓練紀錄與進度照片。
規則：
1. 數字以 InBody/手動紀錄為準；不可只靠外觀猜測精確體脂率、疾病或健康狀態。
2. 照片只能用於描述相同角度下可見的長期變化，需說明光線、姿勢與拍攝距離的限制。
3. 建議聚焦訓練量、頻率、恢復與目標一致性；不要提供診斷或治療。
4. 資料不足要明說，所有證據引用輸入中的具體數字或訓練趨勢。`;

  function trainingPayload() {
    const trend = FL.weeklyTrend(8, new Date()).map((x) => ({ week: FL.localDateKey(x.weekStart.toISOString()), workouts: x.count, volume_kg: Math.round(x.volume), duration_min: Math.round(x.duration / 60000) }));
    const recent = FL.workoutsInDays(28);
    return {
      trend_8_weeks: trend,
      muscle_distribution_28d: FL.muscleDistribution(recent).map((x) => ({ group: MUSCLE_GROUPS[x.group]?.zh || x.group, volume_kg: Math.round(x.volume) })),
      movement_balance_28d: FL.movementBalance(recent),
    };
  }

  async function openAnalyzeConsent() {
    if (!FL.hasApiKey()) return alert("請先到「更多 → AI 設定」輸入 API Key。");
    const photos = (await listPhotos()).filter((p) => p.kind === "progress").slice(0, 3);
    const record = latestBodyRecord();
    ui.els.modal.classList.remove("hidden");
    ui.els.modal.innerHTML = `<div class="modal-sheet"><div class="ov-header static-head"><button class="icon-btn" id="anCancel">取消</button><span class="ov-title">確認 AI 分析</span><span></span></div>
      <div class="privacy-callout sensitive"><span>SENSITIVE DATA</span>本次會將 ${photos.length} 張進度照片、最新 InBody 數值、目標及近 8 週訓練摘要傳送至你設定的 AI 供應商。</div>
      <label class="consent-check"><input type="checkbox" id="anConsent">我了解照片與身體資料會在本次分析中傳送；分析不是醫療診斷。</label>
      <button class="btn btn-primary" id="anRun" disabled>✦ 同意並開始分析</button></div>`;
    $("anCancel").onclick = ui.closeModal;
    $("anConsent").onchange = (event) => { $("anRun").disabled = !event.target.checked; };
    $("anRun").onclick = async (event) => {
      event.target.disabled = true; event.target.textContent = "✦ 分析中…";
      try {
        const images = [];
        for (const photo of photos) images.push(await blobToDataUrl(photo.blob));
        const payload = { goal: FL.db.settings.bodyGoal, latest_inbody: record, training: trainingPayload(), photo_metadata: photos.map((p) => ({ angle: p.angle, date: p.date })) };
        const result = await FL.structured(BODY_SYSTEM, `請分析以下資料：\n${JSON.stringify(payload)}`, BODY_SCHEMA, null, 5000, { images });
        FL.db.bodyAnalyses.push({ id: uid(), createdAt: new Date().toISOString(), date: localDate(), provider: result.provider, model: result.model, bodyRecordId: record?.id || null, photoIds: photos.map((p) => p.id), content: result.content });
        save(); ui.closeModal(); ui.renderBody(); ui.showToast("✓ 綜合分析完成");
      } catch (error) { alert(`分析失敗：${error.message}`); event.target.disabled = false; event.target.textContent = "✦ 同意並開始分析"; }
    };
  }

  Object.assign(FL, { listBodyPhotos: listPhotos, getBodyPhoto: getPhoto, deleteBodyPhoto: deletePhoto });
})(window.FL);
