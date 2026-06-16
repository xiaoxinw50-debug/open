const state = {
  papers: [],
  settings: null,
  activeView: "ranking",
  sort: "gamma"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

document.addEventListener("DOMContentLoaded", async () => {
  bindTabs();
  bindForms();
  await loadAll();
});

function bindTabs() {
  $$(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      $$(".tab").forEach((item) => item.classList.toggle("is-active", item === button));
      $$(".view").forEach((view) => view.classList.toggle("is-active", view.id === state.activeView));
    });
  });

  $("#sort-select").addEventListener("change", async (event) => {
    state.sort = event.target.value;
    await loadPapers();
  });

  $("#refresh-btn").addEventListener("click", loadAll);
  $("#quick-ingest-btn").addEventListener("click", runIngest);
}

function bindForms() {
  $("#paper-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formToPaper(event.currentTarget);
    const method = payload.id ? "PATCH" : "POST";
    const url = payload.id ? `/api/papers/${encodeURIComponent(payload.id)}` : "/api/papers";
    await api(url, { method, body: JSON.stringify(payload) });
    event.currentTarget.reset();
    $("#calc-preview").classList.remove("is-visible");
    await loadAll();
    switchView("ranking");
  });

  $("#preview-btn").addEventListener("click", async () => {
    const payload = formToPaper($("#paper-form"));
    const preview = await api("/api/calculate", { method: "POST", body: JSON.stringify(payload) });
    renderPreview(preview);
  });

  $("#ingest-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formToSettings(event.currentTarget);
    const settings = await api("/api/state", { method: "PATCH", body: JSON.stringify(payload) });
    state.settings = settings;
    renderSettings();
    log(`设置已保存。\n${JSON.stringify(settings, null, 2)}`);
  });

  $("#run-ingest-btn").addEventListener("click", runIngest);
}

async function loadAll() {
  await Promise.all([loadPapers(), loadSettings(), loadStats()]);
}

async function loadPapers() {
  state.papers = await api(`/api/papers?sort=${encodeURIComponent(state.sort)}`);
  renderRanking();
  renderCandidates();
  renderChart();
}

async function loadSettings() {
  state.settings = await api("/api/state");
  renderSettings();
}

async function loadStats() {
  const stats = await api("/api/stats");
  $("#stat-total").textContent = stats.total;
  $("#stat-calculated").textContent = stats.calculated;
  $("#stat-review").textContent = stats.needsReview;
}

async function runIngest() {
  switchView("ingest");
  log("正在检索 OpenAlex 与 Crossref。若网络或出版商接口较慢，请等待。");
  try {
    const summary = await api("/api/ingest/run", { method: "POST", body: JSON.stringify({}) });
    log(JSON.stringify(summary, null, 2));
    await loadAll();
  } catch (error) {
    log(`检索失败：${error.message}`);
  }
}

function renderRanking() {
  const rows = state.papers.filter((paper) => paper.metrics.canCalculateGamma);
  const body = $("#ranking-body");
  body.innerHTML = "";
  if (!rows.length) return renderEmpty(body, 9);

  rows.forEach((paper, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="metric">${index + 1}</td>
      <td>${paperLink(paper)}${metaLine(paper)}<div class="meta">${escapeHtml(paper.sourceTrace || "")}</div></td>
      <td>${escapeHtml([paper.material, paper.deviceType].filter(Boolean).join(" / ") || "-")}</td>
      <td>${num(paper.params.ionUaPerUm)}<div class="meta">μA/μm</div></td>
      <td>${num(paper.params.rcOhmUm)}<div class="meta">Ω·μm，${rcLabel(paper.params.rcDefinition)}</div></td>
      <td>${num(paper.params.ssMvDec)}<div class="meta">mV/dec</div></td>
      <td><span class="metric">${num(paper.metrics.gamma2d)}</span><div class="meta">Π₂D ${num(paper.metrics.pi2d)}</div></td>
      <td>${classPill(paper.metrics.marginClass)}</td>
      <td>${actions(paper)}</td>
    `;
    body.appendChild(tr);
  });
  bindRowActions();
}

function renderCandidates() {
  const rows = state.papers.filter((paper) => !paper.metrics.canCalculateGamma);
  const body = $("#candidate-body");
  body.innerHTML = "";
  if (!rows.length) return renderEmpty(body, 6);

  rows.forEach((paper) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${paper.year || "-"}</td>
      <td>${paperLink(paper)}${metaLine(paper)}</td>
      <td>${escapeHtml(paper.sourceType || "-")}<div class="meta">${escapeHtml(paper.journal || "")}</div></td>
      <td>${paper.metrics.missingFields.map((item) => `<span class="pill warn">${escapeHtml(item)}</span>`).join(" ")}</td>
      <td><span class="meta">${escapeHtml(paper.params.notes || paper.sourceTrace || "")}</span></td>
      <td>${actions(paper)}</td>
    `;
    body.appendChild(tr);
  });
  bindRowActions();
}

function renderChart() {
  const target = $("#chart");
  const rows = state.papers
    .filter((paper) => paper.metrics.gamma2d !== null)
    .slice()
    .sort((a, b) => b.metrics.gamma2d - a.metrics.gamma2d)
    .slice(0, 8);
  target.innerHTML = "";
  if (!rows.length) return;

  const max = Math.max(...rows.map((paper) => paper.metrics.gamma2d), 1);
  rows.forEach((paper) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label" title="${escapeAttr(paper.title)}">${escapeHtml(paper.authors || paper.title)}</div>
      <div class="bar-track"><div class="bar" style="width:${Math.max(4, (paper.metrics.gamma2d / max) * 100)}%"></div></div>
      <div class="bar-value">${num(paper.metrics.gamma2d)}</div>
    `;
    target.appendChild(row);
  });
}

function renderSettings() {
  if (!state.settings) return;
  const form = $("#ingest-form");
  form.lookbackDays.value = state.settings.lookbackDays;
  form.maxPerQuery.value = state.settings.maxPerQuery;
  form.ingestIntervalHours.value = state.settings.ingestIntervalHours;
  form.autoIngestEnabled.checked = Boolean(state.settings.autoIngestEnabled);
  form.queries.value = (state.settings.queries || []).join("\n");
  if (state.settings.lastRunSummary) {
    log(`上次检索：\n${JSON.stringify(state.settings.lastRunSummary, null, 2)}`);
  }
}

function renderPreview(paper) {
  const box = $("#calc-preview");
  const m = paper.metrics;
  box.classList.add("is-visible");
  box.innerHTML = `
    <div class="preview-grid">
      ${previewItem("Π₂D", num(m.pi2d), "驱动-接触观察量")}
      ${previewItem("Vdrop", `${num(m.contactDropV)} V`, "接触电压损耗")}
      ${previewItem("Veff", `${num(m.effectiveVoltageV)} V`, "有效电压余量")}
      ${previewItem("Vsw", `${num(m.switchCostV)} V`, "开关电压代价")}
      ${previewItem("Γ₂D", num(m.gamma2d), m.marginClass)}
    </div>
    <p>${m.canCalculateGamma ? "该样本可计算 Γ₂D。" : `仍缺少：${m.missingFields.join("、")}`}</p>
  `;
}

function previewItem(title, value, note) {
  return `<div class="preview-item"><span>${title}</span><b>${value}</b><small>${note}</small></div>`;
}

function bindRowActions() {
  $$("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const paper = state.papers.find((item) => item.id === button.dataset.edit);
      if (paper) fillForm(paper);
      switchView("manual");
    });
  });

  $$("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("确认删除这条记录？")) return;
      await api(`/api/papers/${encodeURIComponent(button.dataset.delete)}`, { method: "DELETE" });
      await loadAll();
    });
  });
}

function fillForm(paper) {
  const form = $("#paper-form");
  form.id.value = paper.id || "";
  form.title.value = paper.title || "";
  form.authors.value = paper.authors || "";
  form.year.value = paper.year || "";
  form.journal.value = paper.journal || "";
  form.doi.value = paper.doi || "";
  form.url.value = paper.url || "";
  form.material.value = paper.material || "";
  form.deviceType.value = paper.deviceType || "";
  form.ionUaPerUm.value = paper.params.ionUaPerUm ?? "";
  form.rcOhmUm.value = paper.params.rcOhmUm ?? "";
  form.rcDefinition.value = paper.params.rcDefinition || "unknown";
  form.vdsV.value = paper.params.vdsV ?? "";
  form.ssMvDec.value = paper.params.ssMvDec ?? "";
  form.logSwitchRatio.value = paper.params.logSwitchRatio ?? "";
  form.onOffRatio.value = paper.params.onOffRatio ?? "";
  form.notes.value = paper.params.notes || "";
  form.sourceTrace.value = paper.sourceTrace || "";
}

function formToPaper(form) {
  return {
    id: form.id.value || undefined,
    title: form.title.value.trim(),
    authors: form.authors.value.trim(),
    year: numberOrNull(form.year.value),
    journal: form.journal.value.trim(),
    doi: form.doi.value.trim(),
    url: form.url.value.trim(),
    material: form.material.value.trim(),
    deviceType: form.deviceType.value.trim(),
    sourceTrace: form.sourceTrace.value.trim(),
    sourceType: "manual",
    params: {
      ionUaPerUm: numberOrNull(form.ionUaPerUm.value),
      rcOhmUm: numberOrNull(form.rcOhmUm.value),
      rcDefinition: form.rcDefinition.value,
      vdsV: numberOrNull(form.vdsV.value),
      ssMvDec: numberOrNull(form.ssMvDec.value),
      logSwitchRatio: numberOrNull(form.logSwitchRatio.value),
      onOffRatio: numberOrNull(form.onOffRatio.value),
      notes: form.notes.value.trim()
    }
  };
}

function formToSettings(form) {
  return {
    lookbackDays: numberOrNull(form.lookbackDays.value),
    maxPerQuery: numberOrNull(form.maxPerQuery.value),
    ingestIntervalHours: numberOrNull(form.ingestIntervalHours.value),
    autoIngestEnabled: form.autoIngestEnabled.checked,
    queries: form.queries.value
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
  };
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

function switchView(id) {
  const tab = $(`.tab[data-view="${id}"]`);
  if (tab) tab.click();
}

function renderEmpty(body, columns) {
  body.innerHTML = `<tr><td colspan="${columns}" class="empty">暂无数据</td></tr>`;
}

function paperLink(paper) {
  const title = escapeHtml(paper.title || "Untitled");
  if (paper.url) {
    return `<a class="paper-title" href="${escapeAttr(paper.url)}" target="_blank" rel="noreferrer">${title}</a>`;
  }
  return `<div class="paper-title">${title}</div>`;
}

function metaLine(paper) {
  return `<div class="meta">${escapeHtml([paper.authors, paper.journal, paper.year].filter(Boolean).join(" · "))}</div>`;
}

function actions(paper) {
  return `
    <div class="row-actions">
      <button class="secondary" data-edit="${escapeAttr(paper.id)}">编辑</button>
      <button class="ghost" data-delete="${escapeAttr(paper.id)}">删除</button>
    </div>
  `;
}

function classPill(label) {
  const klass = label === "裕量较充足" ? "good" : label === "接近边界" ? "warn" : label === "裕量不足" ? "bad" : "";
  return `<span class="pill ${klass}">${escapeHtml(label)}</span>`;
}

function rcLabel(value) {
  if (value === "single") return "单侧";
  if (value === "total") return "总等效";
  return "未确定";
}

function num(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const number = Number(value);
  if (Math.abs(number) >= 1000) return number.toFixed(0);
  if (Math.abs(number) >= 100) return number.toFixed(1);
  if (Math.abs(number) >= 10) return number.toFixed(2);
  return number.toFixed(3);
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function log(text) {
  $("#ingest-log").textContent = text;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value = "") {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
