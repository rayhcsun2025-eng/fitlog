/* =====================================================================
   FitLog v2 — 進入點（Bootstrap）
   ===================================================================== */
"use strict";
(function (FL) {
  FL.loadDB();
  FL.updatePreferenceProfile(); // 讓既有資料的常用動作立即供 AI 排課參考
  FL.ui.init();

  // Tab 切換
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      FL.ui.currentTab = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      FL.ui.renderTab();
    });
  });

  // 持久儲存（降低系統自動清除機率）
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // Service Worker（離線）
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  FL.ui.renderTab();
})(window.FL);
