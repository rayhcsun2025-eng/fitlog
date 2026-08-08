/* =====================================================================
   FitLog v3 — 身體目標、InBody 圖片辨識與 AI 數據分析
   InBody 圖片不進 localStorage；辨識前縮圖並移除 EXIF。
   ===================================================================== */
"use strict";
window.FL = window.FL || {};

(function (FL) {
  const ui = FL.ui;
  const $ = (id) => document.getElementById(id);
  const { esc, save, uid, fmtVolume, MUSCLE_GROUPS } = FL;
  const DB_NAME = "fitlog.body.v1";
  const STORE = "photos";

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

  const storePhoto = (photo) => photoTx("readwrite", (s) => s.put(photo));

  function localDate() { return FL.localDateKey(new Date().toISOString()); }
  function numOrNull(value) { const n = Number(value); return value === "" || !Number.isFinite(n) ? null : n; }
  function inRange(value, min, max) {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }
  const SEGMENTS = [
    ["leftArm", "左手臂", 0.1, 30], ["rightArm", "右手臂", 0.1, 30],
    ["trunk", "軀幹", 1, 100], ["leftLeg", "左下肢", 0.5, 60], ["rightLeg", "右下肢", 0.5, 60],
  ];
  function sanitizeBodyRecord(record) {
    const source = record || {};
    const clean = { ...source };
    clean.weightKg = inRange(source.weightKg, 20, 400);
    clean.skeletalMuscleKg = inRange(source.skeletalMuscleKg, 5, 120);
    clean.bodyFatPct = inRange(source.bodyFatPct, 2, 75);
    clean.fatMassKg = inRange(source.fatMassKg, 0.2, 250);
    clean.bmi = inRange(source.bmi, 10, 80);
    clean.visceralFat = inRange(source.visceralFat, 1, 30);
    clean.visceralFatAreaCm2 = inRange(source.visceralFatAreaCm2, 1, 400);
    clean.bmrKcal = inRange(source.bmrKcal, 500, 5000);
    const segmental = {};
    let hasSegmental = false;
    for (const [key,, min, max] of SEGMENTS) {
      const part = source.segmentalLean?.[key] || {};
      const massKg = inRange(part.massKg, min, max);
      const sufficiencyPct = inRange(part.sufficiencyPct, 30, 250);
      segmental[key] = { massKg, sufficiencyPct };
      if (massKg != null || sufficiencyPct != null) hasSegmental = true;
    }
    clean.segmentalLean = hasSegmental ? segmental : null;
    return clean;
  }
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
    const latest = [...FL.db.bodyRecords].sort((a, b) => b.date.localeCompare(a.date))[0];
    return latest ? sanitizeBodyRecord(latest) : null;
  }

  function goalLabel(type) {
    return { muscle: "增肌", fatloss: "減脂", recomposition: "體態重組", strength: "力量提升" }[type] || "體態重組";
  }

  function sideDifference(left, right) {
    if (left == null || right == null || Math.max(left, right) <= 0) return null;
    return Math.round((Math.abs(left - right) / Math.max(left, right)) * 1000) / 10;
  }

  function segmentalPanelHTML(record) {
    const data = record?.segmentalLean;
    if (!data) return "";
    const tiles = SEGMENTS.map(([key, label]) => {
      const part = data[key] || {};
      if (part.massKg == null && part.sufficiencyPct == null) return "";
      const width = part.sufficiencyPct == null ? 0 : Math.max(4, Math.min(100, (part.sufficiencyPct / 150) * 100));
      return `<div class="segment-tile ${key}"><div class="segment-top"><span>${label}</span><strong>${metric(part.massKg,"kg")}</strong></div>
        <div class="segment-track"><i style="width:${width}%"></i><b></b></div><small>${part.sufficiencyPct == null ? "參考率 —" : `參考率 ${metric(part.sufficiencyPct,"%",1)}`}</small></div>`;
    }).join("");
    const armDiff = sideDifference(data.leftArm?.massKg, data.rightArm?.massKg);
    const legDiff = sideDifference(data.leftLeg?.massKg, data.rightLeg?.massKg);
    return `<section class="segment-panel"><div class="section-head segment-head"><div><h2 class="section-title">分段瘦體重</h2><p>五部位 Lean Mass，包含體水分，不等同純肌肉量。</p></div><span class="provider-badge">5 SEGMENTS</span></div>
      <div class="segment-grid">${tiles}</div>
      ${(armDiff != null || legDiff != null) ? `<div class="balance-readout">${armDiff != null ? `<span>左右手差 <strong>${armDiff}%</strong></span>` : ""}${legDiff != null ? `<span>左右腿差 <strong>${legDiff}%</strong></span>` : ""}</div>` : ""}</section>`;
  }

  ui.renderBody = async function () {
    const el = ui.els.view;
    if (ui.currentTab !== "body") return;
    const latest = latestBodyRecord();
    const goal = FL.db.settings.bodyGoal || {};
    const analysis = [...FL.db.bodyAnalyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

    el.innerHTML = `<div class="page-kicker">BODY INTELLIGENCE</div>
      <div class="page-head-row"><div><h1 class="page-title">身體與目標</h1><p class="page-subtitle">整合 InBody、訓練紀錄與目標，追蹤可驗證的數據變化。</p></div>
        <button class="icon-action" id="bodyGoalEdit" aria-label="編輯目標">⌁</button></div>
      <section class="goal-hero">
        <div><span class="signal-label">ACTIVE GOAL</span><h2>${goalLabel(goal.type)}</h2>
          <p>${goal.targetDate ? `目標日 ${esc(goal.targetDate)}` : "設定數字目標，讓 AI 建議更精準"}</p></div>
        <div class="goal-target"><span>${metric(goal.targetWeightKg, "kg")}</span><small>目標體重</small></div>
      </section>

      <div class="action-grid body-actions">
        <button class="action-tile" id="bodyAddInbody"><span class="action-icon scan">▣</span><strong>掃描 InBody</strong><small>AI 辨識後確認數值</small></button>
      </div>

      <h2 class="section-title">最新身體組成</h2>
      ${latest ? `<div class="metric-strip">
        <div><span>${metric(latest.weightKg,"kg")}</span><small>體重</small></div>
        <div><span>${metric(latest.skeletalMuscleKg,"kg")}</span><small>骨骼肌</small></div>
        <div><span>${metric(latest.bodyFatPct,"%")}</span><small>體脂率</small></div>
        <div><span>${latest.visceralFat != null ? metric(latest.visceralFat,"級",0) : metric(latest.visceralFatAreaCm2,"cm²",0)}</span><small>內臟脂肪</small></div></div>
        <div class="hint data-stamp">資料日期 ${esc(latest.date)} · ${latest.source === "scan" ? "AI 掃描後確認" : "手動輸入"}</div>`
        : `<div class="empty-state compact"><span class="empty-orbit"></span><strong>尚未建立身體基準</strong><p>掃描一張 InBody 報告，或手動輸入數值。</p></div>`}

      ${latest ? segmentalPanelHTML(latest) : ""}

      <div class="section-head"><h2 class="section-title">AI 身體分析</h2>${analysis ? `<span class="provider-badge">${esc(analysis.provider || "AI")}</span>` : ""}</div>
      ${analysis ? analysisHTML(analysis.content) : `<div class="card intelligence-card"><span class="signal-label">DATA FUSION</span>
        <h3>把 InBody、訓練紀錄與目標放在同一份報告</h3><p>AI 會依據確認過的身體組成與訓練趨勢，整理數據證據與可執行建議。</p></div>`}
      <button class="btn btn-primary ai-analyze-btn" id="bodyAnalyze" ${!latest ? "disabled" : ""}>✦ 產生綜合分析</button>`;

    $("bodyGoalEdit").onclick = openGoalModal;
    $("bodyAddInbody").onclick = openInBodyModal;
    $("bodyAnalyze").onclick = openAnalyzeConsent;
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

  function segmentInputRow(id, label) {
    return `<div class="segment-input-row"><label>${label}</label>
      <div><input class="form-input" type="number" inputmode="decimal" step="0.01" id="${id}Kg" placeholder="—"><span>kg</span></div>
      <div><input class="form-input" type="number" inputmode="decimal" step="0.1" id="${id}Pct" placeholder="—"><span>%</span></div></div>`;
  }

  const SEGMENT_SCHEMA = {
    type: "object", additionalProperties: false, required: ["mass_kg", "sufficiency_pct"],
    properties: { mass_kg: { type: ["number","null"] }, sufficiency_pct: { type: ["number","null"] } },
  };
  const INBODY_SCHEMA = {
    type: "object", additionalProperties: false,
    required: ["scan_date","mass_unit_detected","weight_kg","skeletal_muscle_kg","body_fat_pct","fat_mass_kg","bmi","visceral_fat_level","visceral_fat_area_cm2","bmr_kcal","segmental_lean","notes"],
    properties: {
      scan_date: { type: ["string","null"] },
      mass_unit_detected: { type: "string", enum: ["kg","lb","mixed","unknown"] },
      weight_kg: { type: ["number","null"] },
      skeletal_muscle_kg: { type: ["number","null"] }, body_fat_pct: { type: ["number","null"] },
      fat_mass_kg: { type: ["number","null"] }, bmi: { type: ["number","null"] },
      visceral_fat_level: { type: ["number","null"] }, visceral_fat_area_cm2: { type: ["number","null"] },
      bmr_kcal: { type: ["number","null"] },
      segmental_lean: {
        type: "object", additionalProperties: false,
        required: ["left_arm","right_arm","trunk","left_leg","right_leg"],
        properties: { left_arm: SEGMENT_SCHEMA, right_arm: SEGMENT_SCHEMA, trunk: SEGMENT_SCHEMA, left_leg: SEGMENT_SCHEMA, right_leg: SEGMENT_SCHEMA },
      },
      notes: { type: "array", items: { type: "string" } },
    },
  };
  const INBODY_SYSTEM = `你是身體組成報告的資料擷取助手。只讀取圖片中清楚可見且能確認欄位與單位的數字，不猜測，不提供醫療診斷。
規則：
1. 日期用 YYYY-MM-DD。無法確認就回傳 null。
2. 質量若明確標示 lb/lbs/pound，使用 1 lb = 0.453592 kg 換算後回傳 kg；若單位不明，該質量欄位回傳 null。百分比不可當成 kg。
3. Segmental Lean Analysis 是分段瘦體重，不是純骨骼肌。擷取左手臂、右手臂、軀幹、左下肢、右下肢的質量 kg 與報告上的參考／充足率 %。
4. 內臟脂肪「等級」與「面積 cm²」必須分開，不可互填。
5. 明顯不合理或疑似單位誤判的值回傳 null：體重 20–400kg、骨骼肌 5–120kg、體脂 2–75%、脂肪量 0.2–250kg、BMI 10–80、內臟脂肪等級 1–30、面積 1–400cm²、BMR 500–5000kcal；單側手臂 0.1–30kg、軀幹 1–100kg、單側腿 0.5–60kg、分段參考率 30–250%。
6. 不同欄位互相矛盾或字跡不清時寧可留 null，並在 notes 簡短說明。`;

  function scanContentToRecord(content) {
    const c = content || {};
    const s = c.segmental_lean || {};
    return sanitizeBodyRecord({
      weightKg: c.weight_kg, skeletalMuscleKg: c.skeletal_muscle_kg, bodyFatPct: c.body_fat_pct,
      fatMassKg: c.fat_mass_kg, bmi: c.bmi, visceralFat: c.visceral_fat_level,
      visceralFatAreaCm2: c.visceral_fat_area_cm2, bmrKcal: c.bmr_kcal,
      segmentalLean: {
        leftArm: { massKg: s.left_arm?.mass_kg, sufficiencyPct: s.left_arm?.sufficiency_pct },
        rightArm: { massKg: s.right_arm?.mass_kg, sufficiencyPct: s.right_arm?.sufficiency_pct },
        trunk: { massKg: s.trunk?.mass_kg, sufficiencyPct: s.trunk?.sufficiency_pct },
        leftLeg: { massKg: s.left_leg?.mass_kg, sufficiencyPct: s.left_leg?.sufficiency_pct },
        rightLeg: { massKg: s.right_leg?.mass_kg, sufficiencyPct: s.right_leg?.sufficiency_pct },
      },
    });
  }

  function openInBodyModal() {
    ui.els.modal.classList.remove("hidden");
    ui.els.modal.innerHTML = `<div class="modal-sheet"><div class="ov-header static-head">
      <button class="icon-btn" id="ibCancel">取消</button><span class="ov-title">新增 InBody</span><button class="icon-btn accent" id="ibSave">儲存</button></div>
      <div class="privacy-callout"><span>REVIEW FIRST</span>AI 會換算明確標示的 lb；單位不明、超出合理範圍或互相矛盾的值會留空，再由你確認。</div>
      <div class="card form-card"><div class="upload-source-label">選擇 InBody 圖片來源</div>
        <div class="upload-source-grid">
          <label class="upload-source-card"><input type="file" id="ibFile" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif">
            <span>LIB</span><strong>相簿／檔案</strong><small>選擇已拍好的圖片</small></label>
          <label class="upload-source-card camera"><input type="file" id="ibCamera" accept="image/*" capture="environment">
            <span>CAM</span><strong>直接拍照</strong><small>開啟手機後鏡頭</small></label>
        </div>
        <button class="btn btn-card scan-btn" id="ibScan">▣ AI 讀取報告</button><div class="hint" id="ibStatus"></div>
        <div class="form-row"><label>日期</label><input class="form-input inline-input" id="ibDate" type="date" value="${localDate()}"></div>
        ${numberRow("ibWeight","體重","kg",null)}${numberRow("ibMuscle","骨骼肌","kg",null)}
        ${numberRow("ibFatPct","體脂率","%",null)}${numberRow("ibFatMass","脂肪量","kg",null)}
        ${numberRow("ibBMI","BMI","",null)}${numberRow("ibVisceral","內臟脂肪","級",null)}
        ${numberRow("ibVisceralArea","內臟脂肪面積","cm²",null)}
        ${numberRow("ibBMR","基礎代謝","kcal",null)}
        <div class="scan-section-title"><span>SEGMENTAL LEAN</span><strong>分段瘦體重</strong><small>報告質量 kg／參考率 %；並非純肌肉量</small></div>
        <div class="segment-input-head"><span>部位</span><span>質量</span><span>參考率</span></div>
        ${segmentInputRow("segLeftArm","左手臂")}${segmentInputRow("segRightArm","右手臂")}
        ${segmentInputRow("segTrunk","軀幹")}${segmentInputRow("segLeftLeg","左下肢")}${segmentInputRow("segRightLeg","右下肢")}
        <div class="form-row no-border"><label>備註</label><input class="form-input inline-input wide" id="ibNotes" placeholder="選填"></div></div></div>`;
    let scanBlob = null, selectedFile = null, detectedMassUnit = "kg";
    $("ibCancel").onclick = ui.closeModal;
    const selectInBodyFile = (file, source) => {
      selectedFile = file || null;
      scanBlob = null;
      $("ibStatus").textContent = file ? `✓ ${source}：${file.name || "InBody 圖片"}` : "";
    };
    $("ibFile").onchange = () => selectInBodyFile($("ibFile").files[0], "已從相簿／檔案選擇");
    $("ibCamera").onchange = () => selectInBodyFile($("ibCamera").files[0], "已拍攝");
    $("ibScan").onclick = async (event) => {
      const file = selectedFile; if (!file) return alert("請先從相簿選擇圖片或直接拍照");
      if (!FL.hasApiKey()) return alert("請先到「更多 → AI 設定」輸入 API Key。");
      event.target.disabled = true; $("ibStatus").textContent = "AI 辨識中…";
      try {
        scanBlob = await compressImage(file, 1800, 0.86);
        const image = await blobToDataUrl(scanBlob);
        const result = await FL.structured(INBODY_SYSTEM, "擷取這張 InBody 報告的欄位。", INBODY_SCHEMA, null, 2500, { images: [image] });
        const c = result.content;
        const clean = scanContentToRecord(c);
        detectedMassUnit = c.mass_unit_detected || "unknown";
        $("ibDate").value = /^\d{4}-\d{2}-\d{2}$/.test(c.scan_date || "") ? c.scan_date : $("ibDate").value;
        [["ibWeight",clean.weightKg],["ibMuscle",clean.skeletalMuscleKg],["ibFatPct",clean.bodyFatPct],["ibFatMass",clean.fatMassKg],
          ["ibBMI",clean.bmi],["ibVisceral",clean.visceralFat],["ibVisceralArea",clean.visceralFatAreaCm2],["ibBMR",clean.bmrKcal]].forEach(([id,v]) => { $(id).value = v ?? ""; });
        [["segLeftArm","leftArm"],["segRightArm","rightArm"],["segTrunk","trunk"],["segLeftLeg","leftLeg"],["segRightLeg","rightLeg"]].forEach(([id,key]) => {
          $(id+"Kg").value = clean.segmentalLean?.[key]?.massKg ?? "";
          $(id+"Pct").value = clean.segmentalLean?.[key]?.sufficiencyPct ?? "";
        });
        $("ibNotes").value = (c.notes || []).join("；");
        $("ibStatus").textContent = `✓ 已辨識並過濾異常值 · 單位 ${detectedMassUnit.toUpperCase()} · ${FL.aiModelLabel(result.model)}`;
      } catch (error) { $("ibStatus").textContent = error.message; }
      event.target.disabled = false;
    };
    $("ibSave").onclick = async () => {
      const file = selectedFile;
      if (!scanBlob && file) scanBlob = await compressImage(file, 1800, 0.86);
      let scanPhotoId = null;
      if (scanBlob) {
        scanPhotoId = uid();
        await storePhoto({ id: scanPhotoId, kind: "inbody", angle: "report", date: $("ibDate").value || localDate(), blob: scanBlob, createdAt: new Date().toISOString() });
      }
      const record = sanitizeBodyRecord({
        id: uid(), date: $("ibDate").value || localDate(), weightKg: numOrNull($("ibWeight").value),
        skeletalMuscleKg: numOrNull($("ibMuscle").value), bodyFatPct: numOrNull($("ibFatPct").value),
        fatMassKg: numOrNull($("ibFatMass").value), bmi: numOrNull($("ibBMI").value),
        visceralFat: numOrNull($("ibVisceral").value), visceralFatAreaCm2: numOrNull($("ibVisceralArea").value),
        bmrKcal: numOrNull($("ibBMR").value), detectedMassUnit,
        segmentalLean: {
          leftArm: { massKg: numOrNull($("segLeftArmKg").value), sufficiencyPct: numOrNull($("segLeftArmPct").value) },
          rightArm: { massKg: numOrNull($("segRightArmKg").value), sufficiencyPct: numOrNull($("segRightArmPct").value) },
          trunk: { massKg: numOrNull($("segTrunkKg").value), sufficiencyPct: numOrNull($("segTrunkPct").value) },
          leftLeg: { massKg: numOrNull($("segLeftLegKg").value), sufficiencyPct: numOrNull($("segLeftLegPct").value) },
          rightLeg: { massKg: numOrNull($("segRightLegKg").value), sufficiencyPct: numOrNull($("segRightLegPct").value) },
        }, notes: $("ibNotes").value.trim(), source: scanBlob ? "scan" : "manual", scanPhotoId,
      });
      FL.db.bodyRecords.push(record);
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
  const BODY_SYSTEM = `你是運動表現與身體組成分析助手。請使用繁體中文，整合使用者確認過的 InBody 數字、目標與訓練紀錄。
規則：
1. 數字以 InBody/手動紀錄為準；不可推測疾病或健康狀態。
2. 建議聚焦訓練量、頻率、恢復與目標一致性；不要提供診斷或治療。
3. 資料不足要明說，所有證據引用輸入中的具體數字或訓練趨勢。
4. null、空白或缺少單位的欄位視為不存在，不可推測、補值或拿來形成結論。
5. segmentalLean 是五部位分段瘦體重（Lean Mass），包含體水分，不可稱為純肌肉量；可比較左右差異與報告參考率，但不可據此診斷傷病。
6. 不同測量機器的數字只作當次參考；若來源單位或定義不一致，不做跨次絕對值比較。`;

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
    const record = latestBodyRecord();
    ui.els.modal.classList.remove("hidden");
    ui.els.modal.innerHTML = `<div class="modal-sheet"><div class="ov-header static-head"><button class="icon-btn" id="anCancel">取消</button><span class="ov-title">確認 AI 分析</span><span></span></div>
      <div class="privacy-callout sensitive"><span>SENSITIVE DATA</span>本次會將最新 InBody 數值、目標及近 8 週訓練摘要傳送至你設定的 AI 供應商，不會傳送體態照片。</div>
      <label class="consent-check"><input type="checkbox" id="anConsent">我了解身體組成與訓練資料會在本次分析中傳送；分析不是醫療診斷。</label>
      <button class="btn btn-primary" id="anRun" disabled>✦ 同意並開始分析</button></div>`;
    $("anCancel").onclick = ui.closeModal;
    $("anConsent").onchange = (event) => { $("anRun").disabled = !event.target.checked; };
    $("anRun").onclick = async (event) => {
      event.target.disabled = true; event.target.textContent = "✦ 分析中…";
      try {
        const payload = { goal: FL.db.settings.bodyGoal, latest_inbody: record, training: trainingPayload() };
        const result = await FL.structured(BODY_SYSTEM, `請分析以下資料：\n${JSON.stringify(payload)}`, BODY_SCHEMA, null, 5000);
        FL.db.bodyAnalyses.push({ id: uid(), createdAt: new Date().toISOString(), date: localDate(), provider: result.provider, model: result.model, bodyRecordId: record?.id || null, content: result.content });
        save(); ui.closeModal(); ui.renderBody(); ui.showToast("✓ 綜合分析完成");
      } catch (error) { alert(`分析失敗：${error.message}`); event.target.disabled = false; event.target.textContent = "✦ 同意並開始分析"; }
    };
  }

  Object.assign(FL, {
    sanitizeBodyRecord, scanContentToRecord,
  });
})(window.FL);
