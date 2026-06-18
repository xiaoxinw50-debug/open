const state = {
  papers: [],
  rankingOutput: null,
  settings: null,
  diagnostics: null,
  ingestProgress: null,
  ingestPollTimer: null,
  activeView: "ranking",
  sort: "gamma",
  includeLowValue: false,
  reviewFilter: "all",
  manualExtraction: null,
  digitizer: {
    image: null,
    mode: "origin",
    origin: null,
    max: null,
    points: [],
    scale: 1
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const PENDING_IMPORT_KEY = "switch-margin-pending-import";

document.addEventListener("DOMContentLoaded", async () => {
  bindTabs();
  bindForms();
  bindAuthenticatedImport();
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
    await Promise.all([loadPapers(), loadRankingOutput()]);
  });

  $("#refresh-btn").addEventListener("click", loadAll);
  $("#quick-ingest-btn").addEventListener("click", runIngest);
  $("#copy-ranking-json").addEventListener("click", copyRankingJson);
  $("#download-ranking-csv").addEventListener("click", downloadRankingCsv);
  document.addEventListener("click", handleRowAction);
  document.addEventListener("click", handleReviewFilter);
  $("#include-low-value").addEventListener("change", async (event) => {
    state.includeLowValue = event.target.checked;
    await Promise.all([loadPapers(), loadDiagnostics()]);
  });
}

function bindForms() {
  $("#paper-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await savePaperFromForm(event.currentTarget);
    event.currentTarget.reset();
    state.manualExtraction = null;
    clearPendingImport();
    $("#extract-text-status").textContent = "尚未导入文本";
    $("#calc-preview").classList.remove("is-visible");
    await loadAll();
    switchView("ranking");
  });

  $("#paper-form").addEventListener("reset", () => {
    state.manualExtraction = null;
    clearPendingImport();
    $("#extract-text-status").textContent = "尚未导入文本";
  });

  $("#preview-btn").addEventListener("click", async () => {
    const payload = formToPaper($("#paper-form"));
    const preview = await api("/api/calculate", { method: "POST", body: JSON.stringify(payload) });
    renderPreview(preview);
  });

  $("#extract-text-btn").addEventListener("click", extractTextToForm);
  $("#open-paper-login-btn").addEventListener("click", openPaperLoginFromForm);
  $("#copy-bookmarklet-btn").addEventListener("click", copyBookmarkletScript);
  $("#run-ocr-btn").addEventListener("click", runOcrImport);
  $("#chart-image-input").addEventListener("change", loadDigitizerImage);
  $("#chart-canvas").addEventListener("click", handleDigitizerCanvasClick);
  $("#clear-digitizer-btn").addEventListener("click", clearDigitizer);
  $("#copy-digitizer-csv-btn").addEventListener("click", copyDigitizerCsv);
  $$("[data-digitizer-mode]").forEach((button) => {
    button.addEventListener("click", () => setDigitizerMode(button.dataset.digitizerMode));
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
  $("#login-search-nature").addEventListener("click", () => openLoginSearch("nature"));
  $("#login-search-ieee").addEventListener("click", () => openLoginSearch("ieee"));
  $("#login-search-cnki").addEventListener("click", () => openLoginSearch("cnki"));
  $("#login-search-all").addEventListener("click", runLoginAssistedSearch);
}

function bindAuthenticatedImport() {
  const bookmarklet = $("#import-bookmarklet");
  if (bookmarklet) {
    bookmarklet.href = buildImportBookmarklet();
    bookmarklet.addEventListener("click", (event) => {
      event.preventDefault();
      $("#extract-text-status").textContent = "请把“导入到 Γ₂D”拖到浏览器书签栏；在已登录的论文全文页点击书签即可导入。";
    });
  }

  window.addEventListener("message", async (event) => {
    const payload = event.data || {};
    if (payload.type !== "SM_IMPORT_TEXT" || !payload.text) return;
    await receiveAuthenticatedImport(payload);
  });
}

function buildImportBookmarklet() {
  const targetOrigin = window.location.origin;
  const targetUrl = `${targetOrigin}${window.location.pathname}#manual`;
  const source = `(function(){var s=(window.getSelection&&String(window.getSelection()))||'';var t=s.trim()||((document.body&&document.body.innerText)||document.documentElement.innerText||'');var w=window.open('${targetUrl}','_blank');var p={type:'SM_IMPORT_TEXT',title:document.title,url:location.href,text:t.slice(0,900000)};setTimeout(function(){try{w.postMessage(p,'${targetOrigin}')}catch(e){alert('导入失败：'+e.message)}},1400);})();`;
  return `javascript:${encodeURIComponent(source)}`;
}

async function copyBookmarkletScript() {
  const text = buildImportBookmarklet();
  await copyText(text);
  $("#extract-text-status").textContent = "已复制书签脚本。新建浏览器书签，把网址粘贴为这段脚本即可。";
}

async function receiveAuthenticatedImport(payload) {
  switchView("manual");
  const form = $("#paper-form");
  const pending = getPendingImport();
  if (pending?.id) {
    const paper = await api(`/api/papers/${encodeURIComponent(pending.id)}`);
    fillForm(paper);
  }
  if (!form.title.value && payload.title) form.title.value = payload.title;
  if (!form.url.value && payload.url) form.url.value = payload.url;
  form.fullTextImport.value = payload.text;
  form.sourceTrace.value = appendTextNote(
    form.sourceTrace.value,
    `已登录浏览器页面导入：${payload.url || "未知 URL"}`
  );
  $("#extract-text-status").textContent = pending?.id
    ? `已导入待处理论文“${pending.title || pending.id}”的全文文本，正在抽取并自动保存...`
    : `已从当前登录页面导入 ${payload.text.length} 字符，正在抽取参数...`;
  await extractTextToForm({ autoSave: Boolean(pending?.id), pending });
}

function openPaperLoginFromForm() {
  const form = $("#paper-form");
  const url = paperAccessUrl({
    url: form.url.value.trim(),
    doi: form.doi.value.trim()
  });
  if (!url) {
    $("#extract-text-status").textContent = "请先填写论文 URL 或 DOI，再打开原文登录。";
    return;
  }
  $("#extract-text-status").textContent = "已打开原文页；登录后点击书签栏里的“导入到 Γ₂D”。";
  window.open(url, "_blank", "noopener,noreferrer");
}

async function loadAll() {
  await Promise.all([loadPapers(), loadRankingOutput(), loadSettings(), loadStats(), loadDiagnostics(), loadIngestProgress()]);
}

async function loadPapers() {
  const lowValueFlag = state.includeLowValue ? "&includeLowValue=1" : "";
  state.papers = await api(`/api/papers?sort=${encodeURIComponent(state.sort)}${lowValueFlag}`);
  renderRanking();
  renderCandidates();
  renderChart();
}

async function loadDiagnostics() {
  const lowValueFlag = state.includeLowValue ? "?includeLowValue=1" : "";
  state.diagnostics = await api(`/api/diagnostics${lowValueFlag}`);
  renderDiagnostics();
}

async function loadRankingOutput() {
  state.rankingOutput = await api(`/api/rankings?sort=${encodeURIComponent(state.sort)}`);
  renderRankingOutput();
}

async function loadSettings() {
  state.settings = await api("/api/state");
  renderSettings();
}

async function loadStats() {
  const stats = await api("/api/stats");
  $("#stat-total").textContent = stats.total;
  $("#stat-calculated").textContent = Number(stats.calculated || 0) + Number(stats.estimable || 0);
  $("#stat-review").textContent = stats.needsReview;
}

async function runIngest() {
  switchView("ingest");
  log("正在检索 OpenAlex、Crossref 与 arXiv。若网络或出版商接口较慢，请等待。");
  startIngestPolling();
  try {
    const summary = await api("/api/ingest/run", { method: "POST", body: JSON.stringify({}) });
    log(formatIngestSummary(summary));
    await loadAll();
  } catch (error) {
    log(`检索失败：${error.message}`);
    await loadIngestProgress();
  } finally {
    setTimeout(stopIngestPollingIfIdle, 1400);
  }
}

async function runLoginAssistedSearch() {
  switchView("ingest");
  const opened = openLoginSearch("all");
  $("#login-search-status").textContent = opened
    ? "已打开 Nature/IEEE/知网登录检索页，并开始站内自动检索。登录后打开全文，再点书签栏“导入到 Γ₂D”。"
    : "请先填写登录检索关键词或上方检索关键词。";
  if (opened) await runIngest();
}

function openLoginSearch(target) {
  const query = loginSearchQuery();
  if (!query) {
    $("#login-search-status").textContent = "请先填写登录检索关键词，或在上方关键词框保留至少一行关键词。";
    return false;
  }
  const urls = publisherSearchUrls(query);
  if (target === "nature" || target === "all") window.open(urls.nature, "_blank", "noopener,noreferrer");
  if (target === "ieee" || target === "all") window.open(urls.ieee, "_blank", "noopener,noreferrer");
  if (target === "cnki" || target === "all") window.open(urls.cnki, "_blank", "noopener,noreferrer");
  $("#login-search-status").textContent = `已跳转登录搜索：${query}`;
  return true;
}

function loginSearchQuery() {
  const explicit = $("#login-search-query")?.value.trim();
  if (explicit) return explicit;
  const first = $("#ingest-form")?.queries?.value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)[0];
  return first || "";
}

function publisherSearchUrls(query) {
  const encoded = encodeURIComponent(query);
  return {
    nature: `https://www.nature.com/search?q=${encoded}`,
    ieee: `https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${encoded}`,
    cnki: `https://kns.cnki.net/kns8/defaultresult/index?kw=${encoded}`
  };
}

async function loadIngestProgress() {
  state.ingestProgress = await api("/api/ingest/progress");
  renderIngestProgress();
  if (state.ingestProgress.running) startIngestPolling();
}

function startIngestPolling() {
  if (state.ingestPollTimer) return;
  state.ingestPollTimer = setInterval(async () => {
    try {
      await loadIngestProgress();
      stopIngestPollingIfIdle();
    } catch (error) {
      console.warn("ingest progress polling failed", error);
    }
  }, 1000);
}

function stopIngestPollingIfIdle() {
  if (!state.ingestPollTimer || state.ingestProgress?.running) return;
  clearInterval(state.ingestPollTimer);
  state.ingestPollTimer = null;
}

function renderIngestProgress() {
  const progress = state.ingestProgress;
  if (!progress) return;
  const counters = progress.counters || {};
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
  $("#progress-phase").textContent = phaseLabel(progress.phase, progress.running);
  $("#progress-message").textContent = progress.message || "等待检索任务。";
  $("#progress-percent").textContent = Math.round(percent);
  $("#progress-bar").style.width = `${percent}%`;
  $("#ingest-progress").classList.toggle("is-running", Boolean(progress.running));
  $("#ingest-progress").classList.toggle("is-failed", progress.phase === "failed");
  $("#progress-fetched").textContent = counters.fetchedRaw ?? 0;
  $("#progress-relevant").textContent = counters.relevant ?? 0;
  $("#progress-fulltext").textContent = `${counters.fullTextRead ?? 0}/${counters.fullTextAttempted ?? 0}`;
  $("#progress-saved").textContent = counters.addedOrUpdated ?? 0;
  $("#progress-calculated").textContent = counters.calculated ?? 0;
  $("#progress-review").textContent = counters.needsReview ?? 0;

  const currentParts = [
    progress.currentQuery ? `关键词：${progress.currentQuery}` : "",
    progress.currentSource ? `来源：${progress.currentSource}` : "",
    progress.currentPaper ? `论文：${progress.currentPaper}` : ""
  ].filter(Boolean);
  $("#progress-current").textContent = `当前处理：${currentParts.join(" / ") || "-"}`;
  $("#progress-updated").textContent = `更新时间：${formatTime(progress.updatedAt)}`;
  $("#progress-events").innerHTML = (progress.recent || [])
    .slice(0, 6)
    .map((event) => `<div class="progress-event ${escapeAttr(event.type || "")}"><span>${escapeHtml(formatTime(event.time))}</span>${escapeHtml(event.text || "")}</div>`)
    .join("");
}

function renderRanking() {
  const rows = state.papers.filter((paper) => paper.metrics.gammaMode !== "missing");
  const body = $("#ranking-body");
  body.innerHTML = "";
  if (!rows.length) return renderEmpty(body, 11);

  rows.forEach((paper, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="metric">${index + 1}</td>
      <td>${paperLink(paper)}${metaLine(paper)}<div class="meta">${escapeHtml(paper.sourceTrace || "")}</div>${evidenceLine(paper)}</td>
      <td>${escapeHtml([paper.material, paper.deviceType].filter(Boolean).join(" / ") || "-")}</td>
      <td>${num(paper.params.ionUaPerUm)}${sourceBadge(paper, "ionUaPerUm")}<div class="meta">μA/μm</div></td>
      <td>${num(paper.params.rcOhmUm)}${sourceBadge(paper, "rcOhmUm")}<div class="meta">Ω·μm，${rcLabel(paper.params.rcDefinition)} ${sourceBadge(paper, "rcDefinition")}</div></td>
      <td>${num(paper.params.vdsV)}${sourceBadge(paper, "vdsV")}<div class="meta">V</div></td>
      <td>${num(paper.params.ssMvDec)}${sourceBadge(paper, "ssMvDec")}<div class="meta">mV/dec</div></td>
      <td>${num(paper.metrics.logSwitchRatio)}${sourceBadge(paper, "logSwitchRatio")}<div class="meta">dec</div></td>
      <td>${gammaCell(paper)}</td>
      <td>${classPill(paper.metrics.marginClass)}</td>
      <td>${actions(paper)}</td>
    `;
    body.appendChild(tr);
  });
}

function renderCandidates() {
  renderPendingImportCard();
  const rows = state.papers
    .filter((paper) => paper.metrics.gammaMode !== "strict")
    .filter(matchesReviewFilter)
    .slice()
    .sort(reviewSort);
  const body = $("#candidate-body");
  body.innerHTML = "";
  if (!rows.length) return renderEmpty(body, 8);

  rows.forEach((paper) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${paper.year || "-"}</td>
      <td>${paperLink(paper)}${metaLine(paper)}</td>
      <td>${reviewModeCell(paper)}</td>
      <td>${escapeHtml(paper.sourceType || "-")}<div class="meta">${escapeHtml(paper.journal || "")}</div></td>
      <td>${paper.metrics.missingFields.map((item) => `<span class="pill warn">${escapeHtml(item)}</span>`).join(" ")}</td>
      <td>${partialMetrics(paper)}</td>
      <td><span class="meta">${escapeHtml(paper.params.notes || paper.sourceTrace || "")}</span>${evidenceLine(paper)}</td>
      <td>${actions(paper)}</td>
    `;
    body.appendChild(tr);
  });
}

function matchesReviewFilter(paper) {
  const missing = paper.metrics.missingFields || [];
  if (state.reviewFilter === "rc") return missing.includes("Rc口径");
  if (state.reviewFilter === "core") return missing.includes("Ion") || missing.includes("Rc");
  if (state.reviewFilter === "missing") return paper.metrics.gammaMode === "missing";
  return true;
}

function reviewSort(a, b) {
  const alogin = loginImportPriority(a);
  const blogin = loginImportPriority(b);
  if (alogin !== blogin) return blogin - alogin;
  const arc = a.metrics.missingFields.includes("Rc口径") ? 1 : 0;
  const brc = b.metrics.missingFields.includes("Rc口径") ? 1 : 0;
  if (arc !== brc) return brc - arc;
  const modeRank = { estimated: 0, missing: 1 };
  const am = modeRank[a.metrics.gammaMode] ?? 2;
  const bm = modeRank[b.metrics.gammaMode] ?? 2;
  if (am !== bm) return am - bm;
  return (b.metrics.dataCompleteness || 0) - (a.metrics.dataCompleteness || 0) || (b.year || 0) - (a.year || 0);
}

function loginImportPriority(paper) {
  if (!paperAccessUrl(paper)) return 0;
  if (paper.metrics?.gammaMode === "strict") return 0;
  const missing = paper.metrics?.missingFields || [];
  if (missing.includes("Ion") || missing.includes("Rc") || missing.includes("SS") || missing.includes("VDS") || missing.includes("开关比对数")) {
    return 2;
  }
  return 1;
}

function renderPendingImportCard() {
  const target = $("#pending-import-card");
  if (!target) return;
  const pending = getPendingImport();
  target.hidden = !pending;
  if (!pending) {
    target.innerHTML = "";
    return;
  }
  const next = nextLoginImportCandidate(pending.id);
  target.innerHTML = `
    <div>
      <strong>正在等待登录导入</strong>
      <p>${escapeHtml(pending.title || pending.id)}<br><span>${escapeHtml(pending.url || "")}</span></p>
    </div>
    <div class="pending-import-actions">
      <a class="row-action-link primary" href="${escapeAttr(pending.url || "#")}" target="_blank" rel="noreferrer">继续打开原文</a>
      ${next ? `<button class="secondary" data-next-pending-import>跳过并处理下一篇</button>` : ""}
      <button class="ghost" data-cancel-pending-import>取消</button>
    </div>
  `;
}

function nextLoginImportCandidate(excludeId = "") {
  return state.papers
    .filter((paper) => paper.id !== excludeId)
    .filter((paper) => paper.metrics?.gammaMode !== "strict")
    .filter((paper) => paperAccessUrl(paper))
    .slice()
    .sort(reviewSort)[0] || null;
}

function reviewModeCell(paper) {
  const isEstimated = paper.metrics.gammaMode === "estimated";
  return `
    <span class="pill ${isEstimated ? "warn" : ""}">${isEstimated ? "估算" : "缺参"}</span>
    <div class="meta">${escapeHtml(paper.metrics.reliabilityLabel || paper.metrics.partialStage || "")}</div>
  `;
}

function renderChart() {
  const target = $("#chart");
  const rows = state.papers
    .filter((paper) => paper.metrics.displayGamma2d !== null)
    .slice()
    .sort(compareDisplayGamma)
    .slice(0, 8);
  target.innerHTML = "";
  if (!rows.length) return;

  const max = Math.max(...rows.map((paper) => paper.metrics.displayGamma2d), 1);
  rows.forEach((paper) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label" title="${escapeAttr(paper.title)}">${escapeHtml(paper.authors || paper.title)}</div>
      <div class="bar-track"><div class="bar" style="width:${Math.max(4, (paper.metrics.displayGamma2d / max) * 100)}%"></div></div>
      <div class="bar-value">${num(paper.metrics.displayGamma2d)}${paper.metrics.gammaMode === "estimated" ? "*" : ""}</div>
    `;
    target.appendChild(row);
  });
}

function compareDisplayGamma(a, b) {
  const modeRank = { strict: 0, estimated: 1, missing: 2 };
  const am = modeRank[a.metrics.gammaMode] ?? 3;
  const bm = modeRank[b.metrics.gammaMode] ?? 3;
  if (am !== bm) return am - bm;
  return (b.metrics.displayGamma2d ?? -Infinity) - (a.metrics.displayGamma2d ?? -Infinity);
}

function renderDiagnostics() {
  const target = $("#diagnostics-card");
  if (!target || !state.diagnostics) return;
  const d = state.diagnostics;
  const missing = (d.missingDistribution || []).slice(0, 6);
  const recommendations = d.recommendations || [];
  target.innerHTML = `
    <div class="diagnostics-head">
      <div>
        <span class="progress-label">数据诊断</span>
        <strong>为什么有些论文不能严格计算</strong>
        <p>严格 Γ₂D 需要 Ion、Rc、Rc 口径、VDS、SS 和开关比同时具备；估算排序只作为辅助线索。</p>
      </div>
      <div class="diagnostics-rate">
        <b>${Math.round((d.rankableRate || 0) * 100)}%</b>
        <span>可排序率</span>
      </div>
    </div>
    <div class="diagnostics-grid">
      ${diagnosticItem("严格", d.modeCounts?.strict ?? 0, "六项字段齐全")}
      ${diagnosticItem("估算", d.modeCounts?.estimated ?? 0, "已有 Ion/Rc，可辅助排序")}
      ${diagnosticItem("待补", d.modeCounts?.missing ?? 0, "缺少核心字段")}
      ${diagnosticItem("隐藏", d.hiddenLowValue ?? 0, "低价值自动候选")}
    </div>
    <div class="diagnostics-body">
      <div>
        <h3>缺失字段排行</h3>
        <div class="missing-bars">
          ${missing.length ? missing.map((item) => missingBar(item, d.visible)).join("") : "<span class=\"meta\">暂无缺失字段。</span>"}
        </div>
      </div>
      <div>
        <h3>下一步优先处理</h3>
        <ul class="recommendations">
          ${recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>当前数据结构较完整。</li>"}
        </ul>
      </div>
    </div>
  `;
}

function diagnosticItem(label, value, note) {
  return `<div><b>${Number(value || 0)}</b><span>${escapeHtml(label)}</span><small>${escapeHtml(note)}</small></div>`;
}

function missingBar(item, total) {
  const width = Math.max(6, total ? (item.count / total) * 100 : 0);
  return `
    <div class="missing-bar">
      <span>${escapeHtml(item.field)}</span>
      <div><i style="width:${width}%"></i></div>
      <b>${item.count}</b>
    </div>
  `;
}

function renderRankingOutput() {
  const target = $("#ranking-output");
  if (!state.rankingOutput) {
    target.textContent = "暂无输出数据";
    return;
  }

  const rows = state.rankingOutput.rows.slice(0, 12).map((row) => ({
    rank: row.rank,
    title: row.title,
    year: row.year,
    journal: row.journal,
    material: row.material,
    deviceType: row.deviceType,
    Ion_ua_per_um: row.ionUaPerUm,
    Rc_ohm_um: row.rcOhmUm,
    Rc_definition: row.rcDefinition,
    VDS_V: row.vdsV,
    SS_mV_dec: row.ssMvDec,
    log10_Ion_Ioff: row.logSwitchRatio,
    Ioff_ua_per_um: row.ioffUaPerUm,
    evidence: row.evidence,
    field_provenance: row.fieldProvenance,
    Vdrop_V: row.contactDropV,
    Veff_V: row.effectiveVoltageV,
    trial_Vdrop_V: row.trialContactDropV,
    trial_Veff_V: row.trialEffectiveVoltageV,
    Vsw_V: row.switchCostV,
    Pi_2D: row.pi2d,
    Gamma_2D: row.gamma2d,
    display_Gamma_2D: row.displayGamma2d,
    gamma_mode: row.gammaMode,
    estimated_Gamma_2D: row.estimatedGamma2d,
    estimate_assumptions: row.estimateAssumptions,
    trial_Gamma_2D: row.trialGamma2d,
    Rc_definition_scenarios: row.rcDefinitionScenarios,
    judgment: row.marginClass,
    reliability: row.reliabilityLabel,
    data_quality_score: row.dataQualityScore,
    extraction_confidence: row.extractionConfidence,
    partial_stage: row.partialStage,
    missing: row.missingFields
  }));

  target.textContent = JSON.stringify(
    {
      generatedAt: state.rankingOutput.generatedAt,
      sort: state.rankingOutput.sort,
      totalPapers: state.rankingOutput.totalPapers,
      returned: state.rankingOutput.returned,
      previewRows: rows
    },
    null,
    2
  );
}

function renderSettings() {
  if (!state.settings) return;
  const form = $("#ingest-form");
  form.lookbackDays.value = state.settings.lookbackDays;
  form.maxPerQuery.value = state.settings.maxPerQuery;
  form.ingestIntervalHours.value = state.settings.ingestIntervalHours;
  form.fullTextMaxPerRun.value = state.settings.fullTextMaxPerRun ?? 18;
  form.autoIngestEnabled.checked = Boolean(state.settings.autoIngestEnabled);
  form.fullTextEnabled.checked = Boolean(state.settings.fullTextEnabled);
  form.queries.value = (state.settings.queries || []).join("\n");
  if (state.settings.lastRunSummary) {
    log(`上次检索：\n${formatIngestSummary(state.settings.lastRunSummary)}`);
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

function partialMetrics(paper) {
  const m = paper.metrics || {};
  const rows = [
    m.pi2d !== null ? `Π₂D ${num(m.pi2d)}` : "",
    m.trialContactDropV !== null ? `Vdrop* ${num(m.trialContactDropV)} V` : "",
    m.trialEffectiveVoltageV !== null ? `Veff* ${num(m.trialEffectiveVoltageV)} V` : "",
    m.switchCostV !== null ? `Vsw ${num(m.switchCostV)} V` : "",
    m.trialGamma2d !== null ? `Γ₂D* ${num(m.trialGamma2d)}` : ""
  ].filter(Boolean);
  return `
    <div class="partial-stage">${escapeHtml(m.partialStage || "待补参数")}</div>
    ${rows.length ? `<div class="partial-values">${rows.map((row) => `<span>${escapeHtml(row)}</span>`).join("")}</div>` : ""}
    ${provenanceSummary(paper)}
    ${rcScenarioMarkup(m)}
    <div class="missing-advice">${escapeHtml(missingAdvice(m.missingFields || []))}</div>
    ${m.trialRcAssumption ? `<div class="meta">${escapeHtml(m.trialRcAssumption)}</div>` : ""}
  `;
}

function rcScenarioMarkup(metrics) {
  const scenarios = metrics.rcDefinitionScenarios;
  if (!scenarios || !(metrics.missingFields || []).includes("Rc口径")) return "";
  const strict = scenarios.strict || { total: scenarios.total, single: scenarios.single, sensitivityLabel: scenarios.sensitivityLabel };
  const estimated = scenarios.estimated || null;
  return `
    <div class="rc-scenarios">
      <strong>Rc口径敏感性</strong>
      ${scenarioPairMarkup("严格", strict, "使用已抽取 VDS/SS/开关比")}
      ${estimated && (!strict.total?.gamma2d || !strict.single?.gamma2d) ? scenarioPairMarkup("估算", estimated, `默认假设：${(estimated.assumptions || []).join("；") || "无"}`) : ""}
    </div>
  `;
}

function scenarioPairMarkup(label, scenario, note) {
  const total = scenario?.total || {};
  const single = scenario?.single || {};
  return `
    <section class="rc-scenario-block ${label === "估算" ? "is-estimated" : ""}">
      <div class="rc-scenario-title"><span>${escapeHtml(label)}</span><small>${escapeHtml(note)}</small></div>
      <div><span>总等效</span><b>Γ ${num(total.gamma2d)}</b><small>Vdrop ${num(total.contactDropV)} V</small></div>
      <div><span>单侧</span><b>Γ ${num(single.gamma2d)}</b><small>Vdrop ${num(single.contactDropV)} V</small></div>
      <p>${escapeHtml(scenario?.sensitivityLabel || "")}</p>
    </section>
  `;
}

function missingAdvice(missingFields) {
  if (!missingFields.length) return "字段齐全。";
  const advice = [];
  if (missingFields.includes("Ion") || missingFields.includes("Rc")) {
    advice.push("缺 Ion/Rc：通常需要正文器件表、输出曲线或接触工程图。");
  }
  if (missingFields.includes("VDS")) {
    advice.push("缺 VDS：常在 I-V 图注或测试条件段。");
  }
  if (missingFields.includes("SS")) {
    advice.push("缺 SS：常在转移曲线图注、统计图或补充表。");
  }
  if (missingFields.includes("开关比对数")) {
    advice.push("缺开关比：常写作 on/off ratio 或 Ion/Ioff。");
  }
  if (missingFields.includes("Rc口径")) {
    advice.push("缺 Rc 口径：需确认单侧接触还是源漏总等效。");
  }
  return advice.join(" ");
}

function gammaCell(paper) {
  const m = paper.metrics || {};
  const isEstimated = m.gammaMode === "estimated";
  const value = isEstimated ? m.estimatedGamma2d : m.gamma2d;
  const vdrop = isEstimated ? m.estimatedContactDropV : m.contactDropV;
  const vsw = isEstimated ? m.estimatedSwitchCostV : m.switchCostV;
  const assumptions = Array.isArray(m.estimateAssumptions) ? m.estimateAssumptions : [];
  return `
    <span class="metric">${num(value)}</span>
    <span class="pill ${isEstimated ? "warn" : "good"}">${isEstimated ? "估算" : "严格"}</span>
    <div class="quality-note">${escapeHtml(m.reliabilityLabel || "")}</div>
    <div class="meta">Π₂D ${num(m.pi2d)} · Vdrop ${num(vdrop)} V · Vsw ${num(vsw)} V</div>
    ${assumptions.length ? `<div class="estimate-note">${assumptions.map(escapeHtml).join("；")}</div>` : ""}
  `;
}

function sourceBadge(paper, field) {
  const item = paper.metrics?.fieldProvenance?.[field] || paper.fieldProvenance?.[field];
  if (!item?.source) return "";
  const source = ["original", "derived", "estimated"].includes(item.source) ? item.source : "original";
  const label = sourceLabel(source);
  const detail = [
    item.label ? `${item.label}: ${label}` : label,
    item.note || "",
    item.derivedFrom?.length ? `来源字段：${item.derivedFrom.join(", ")}` : ""
  ].filter(Boolean).join("；");
  return `<span class="source-badge ${escapeAttr(source)}" title="${escapeAttr(detail)}">${escapeHtml(label)}</span>`;
}

function provenanceSummary(paper) {
  const fp = paper.metrics?.fieldProvenance || paper.fieldProvenance || {};
  const labels = {
    ionUaPerUm: "Ion",
    rcOhmUm: "Rc",
    rcDefinition: "Rc口径",
    vdsV: "VDS",
    ssMvDec: "SS",
    logSwitchRatio: "开关比"
  };
  const items = Object.entries(labels)
    .map(([field, label]) => {
      const item = fp[field];
      return item?.source ? `${label}${sourceLabel(item.source)}` : "";
    })
    .filter(Boolean);
  if (!items.length) return "";
  return `<div class="provenance-summary">${items.map(escapeHtml).join(" · ")}</div>`;
}

function sourceLabel(source) {
  if (source === "derived") return "派生";
  if (source === "estimated") return "估算";
  return "原文";
}

async function handleRowAction(event) {
  const editButton = event.target.closest("[data-edit]");
  if (editButton) {
    const paper = state.papers.find((item) => item.id === editButton.dataset.edit);
    if (paper) fillForm(paper);
    switchView("manual");
    return;
  }

  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) {
    if (!confirm("确认删除这条记录？")) return;
    await api(`/api/papers/${encodeURIComponent(deleteButton.dataset.delete)}`, { method: "DELETE" });
    await loadAll();
    return;
  }

  const rcButton = event.target.closest("[data-rc-id]");
  if (rcButton) {
    const paper = state.papers.find((item) => item.id === rcButton.dataset.rcId);
    const label = rcButton.dataset.rcValue === "single" ? "单侧接触" : "源漏总等效";
    if (!paper || !confirm(`确认将这篇论文的 Rc 口径标记为“${label}”？`)) return;
    await api(`/api/papers/${encodeURIComponent(paper.id)}/rc-definition`, {
      method: "PATCH",
      body: JSON.stringify({ rcDefinition: rcButton.dataset.rcValue })
    });
    await loadAll();
    return;
  }

  const loginImportButton = event.target.closest("[data-login-import]");
  if (loginImportButton) {
    const paper = state.papers.find((item) => item.id === loginImportButton.dataset.loginImport);
    if (!paper) return;
    startPendingLoginImport(paper);
    return;
  }

  const cancelPendingButton = event.target.closest("[data-cancel-pending-import]");
  if (cancelPendingButton) {
    clearPendingImport();
    renderPendingImportCard();
    $("#extract-text-status").textContent = "已取消待登录导入。";
    return;
  }

  const nextPendingButton = event.target.closest("[data-next-pending-import]");
  if (nextPendingButton) {
    const current = getPendingImport();
    const next = nextLoginImportCandidate(current?.id || "");
    clearPendingImport();
    renderPendingImportCard();
    if (next) startPendingLoginImport(next);
  }
}

function handleReviewFilter(event) {
  const button = event.target.closest("[data-review-filter]");
  if (!button) return;
  state.reviewFilter = button.dataset.reviewFilter || "all";
  $$(".review-filter").forEach((item) => item.classList.toggle("is-active", item === button));
  renderCandidates();
}

function fillForm(paper) {
  state.manualExtraction = {
    params: {
      evidence: paper.params?.evidence || {},
      provenance: paper.params?.provenance || {}
    }
  };
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
  form.ioffUaPerUm.value = paper.params.ioffUaPerUm ?? "";
  form.fullTextImport.value = "";
  form.notes.value = paper.params.notes || "";
  form.sourceTrace.value = paper.sourceTrace || "";
  $("#extract-text-status").textContent = "可粘贴全文或图表文本继续补参";
}

function formToPaper(form) {
  const extracted = state.manualExtraction?.params || {};
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
      ioffUaPerUm: numberOrNull(form.ioffUaPerUm.value),
      notes: form.notes.value.trim(),
      evidence: extracted.evidence || {},
      provenance: extracted.provenance || {}
    }
  };
}

async function extractTextToForm(options = {}) {
  const form = $("#paper-form");
  const text = form.fullTextImport.value.trim();
  const status = $("#extract-text-status");
  if (text.length < 80) {
    status.textContent = "文本太短：请粘贴参数附近的段落、图注或表格。";
    return;
  }
  status.textContent = "正在抽取参数...";
  const extraction = await api("/api/extract-text", {
    method: "POST",
    body: JSON.stringify({ text })
  });
  const previousParams = state.manualExtraction?.params || {};
  state.manualExtraction = {
    ...extraction,
    params: {
      ...(extraction.params || {}),
      evidence: {
        ...(previousParams.evidence || {}),
        ...(extraction.params?.evidence || {})
      },
      provenance: {
        ...(previousParams.provenance || {}),
        ...(extraction.params?.provenance || {})
      }
    }
  };
  const params = extraction.params || {};
  fillEmptyNumber(form.ionUaPerUm, params.ionUaPerUm);
  fillEmptyNumber(form.rcOhmUm, params.rcOhmUm);
  if ((form.rcDefinition.value === "unknown" || !form.rcDefinition.value) && params.rcDefinition && params.rcDefinition !== "unknown") {
    form.rcDefinition.value = params.rcDefinition;
  }
  fillEmptyNumber(form.vdsV, params.vdsV);
  fillEmptyNumber(form.ssMvDec, params.ssMvDec);
  fillEmptyNumber(form.logSwitchRatio, params.logSwitchRatio);
  fillEmptyNumber(form.ioffUaPerUm, params.ioffUaPerUm);

  const extractedNotes = params.notes ? `文本导入抽取：${params.notes}` : "文本导入未抽到明确参数";
  form.notes.value = appendTextNote(form.notes.value, extractedNotes);
  form.sourceTrace.value = appendTextNote(
    form.sourceTrace.value,
    `人工导入全文/图表文本 ${extraction.textLength} 字符；抽取字段 ${extraction.fieldCount} 个`
  );
  status.textContent = extraction.fieldCount
    ? `已抽取 ${extraction.fieldCount} 个字段，已回填空白参数。请核对数值和证据。`
    : "未抽到可用字段，请粘贴包含单位和上下文的段落或表格。";
  const preview = await api("/api/calculate", { method: "POST", body: JSON.stringify(formToPaper(form)) });
  renderPreview(preview);
  if (options.autoSave && extraction.fieldCount > 0) {
    const saved = await savePaperFromForm(form);
    clearPendingImport();
    $("#extract-text-status").textContent = `已抽取 ${extraction.fieldCount} 个字段，并已自动保存到“${saved.title || options.pending?.title || "当前论文"}”。`;
    await loadAll();
  } else if (options.autoSave) {
    $("#extract-text-status").textContent = "已导入全文，但未抽到可用字段；待导入状态已保留。请选中图注/表格参数段后再次点击书签导入。";
    renderPendingImportCard();
  }
}

async function runOcrImport() {
  const input = $("#ocr-image-input");
  const status = $("#ocr-status");
  const file = input.files?.[0];
  if (!file) {
    status.textContent = "请先选择一张截图。";
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    status.textContent = "图片过大：请裁剪到参数表格、图注或局部正文后再上传。";
    return;
  }
  status.textContent = "正在 OCR 识别，首次加载模型可能需要几十秒...";
  try {
    const imageDataUrl = await fileToDataUrl(file);
    const result = await api("/api/ocr-image", {
      method: "POST",
      body: JSON.stringify({ imageDataUrl, filename: file.name })
    });
    const form = $("#paper-form");
    const header = `\n\n[OCR截图导入：${file.name}]\n`;
    form.fullTextImport.value = `${form.fullTextImport.value.trim()}${header}${result.text}`.trim();
    form.sourceTrace.value = appendTextNote(
      form.sourceTrace.value,
      `OCR 导入截图 ${file.name}，识别字符 ${result.textLength}`
    );
    status.textContent = `OCR 完成：识别 ${result.textLength} 个字符，正在尝试抽取参数...`;
    await extractTextToForm();
  } catch (error) {
    status.textContent = `OCR 失败：${error.message}`;
  }
}

function setDigitizerMode(mode) {
  state.digitizer.mode = mode;
  $$("[data-digitizer-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.digitizerMode === mode);
  });
  const labels = {
    origin: "请点击图中左下坐标轴交点或已知最小坐标点。",
    max: "请点击图中右上坐标轴交点或已知最大坐标点。",
    point: "请点击需要读数的数据点。"
  };
  $("#digitizer-status").textContent = labels[mode] || "请选择取点模式。";
}

async function loadDigitizerImage(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  const dataUrl = await fileToDataUrl(file);
  const image = new Image();
  image.onload = () => {
    state.digitizer.image = image;
    state.digitizer.origin = null;
    state.digitizer.max = null;
    state.digitizer.points = [];
    drawDigitizer();
    setDigitizerMode("origin");
    $("#digitizer-status").textContent = "图像已载入。先点击左下轴点。";
    updateDigitizerOutput();
  };
  image.src = dataUrl;
}

function handleDigitizerCanvasClick(event) {
  const canvas = $("#chart-canvas");
  if (!state.digitizer.image) {
    $("#digitizer-status").textContent = "请先上传图表截图。";
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const point = {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
  if (state.digitizer.mode === "origin") {
    state.digitizer.origin = point;
    setDigitizerMode("max");
  } else if (state.digitizer.mode === "max") {
    state.digitizer.max = point;
    setDigitizerMode("point");
  } else {
    const value = pixelToChartValue(point);
    if (!value) {
      $("#digitizer-status").textContent = "请先完成左下轴点和右上轴点标定。";
      return;
    }
    state.digitizer.points.push({ ...point, ...value });
    $("#digitizer-status").textContent = `已记录第 ${state.digitizer.points.length} 个点：x=${num(value.valueX)}, y=${num(value.valueY)}`;
  }
  drawDigitizer();
  updateDigitizerOutput();
}

function pixelToChartValue(point) {
  const { origin, max } = state.digitizer;
  if (!origin || !max || origin.x === max.x || origin.y === max.y) return null;
  const xMin = numberOrNull($("#chart-x-min").value);
  const xMax = numberOrNull($("#chart-x-max").value);
  const yMin = numberOrNull($("#chart-y-min").value);
  const yMax = numberOrNull($("#chart-y-max").value);
  if ([xMin, xMax, yMin, yMax].some((value) => value === null)) return null;
  return {
    valueX: xMin + ((point.x - origin.x) / (max.x - origin.x)) * (xMax - xMin),
    valueY: yMin + ((origin.y - point.y) / (origin.y - max.y)) * (yMax - yMin)
  };
}

function drawDigitizer() {
  const canvas = $("#chart-canvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fffdfc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const image = state.digitizer.image;
  if (!image) {
    ctx.fillStyle = "#76696a";
    ctx.font = "700 18px Helvetica Neue, sans-serif";
    ctx.fillText("上传图表截图后在这里标定坐标并取点", 28, 46);
    return;
  }
  const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const offsetX = (canvas.width - width) / 2;
  const offsetY = (canvas.height - height) / 2;
  state.digitizer.scale = scale;
  ctx.drawImage(image, offsetX, offsetY, width, height);
  drawMarker(ctx, state.digitizer.origin, "#276c47", "O");
  drawMarker(ctx, state.digitizer.max, "#1865b2", "M");
  state.digitizer.points.forEach((point, index) => drawMarker(ctx, point, "#9e1117", String(index + 1)));
  if (state.digitizer.origin && state.digitizer.max) {
    ctx.save();
    ctx.strokeStyle = "rgba(158,17,23,0.72)";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(
      state.digitizer.origin.x,
      state.digitizer.max.y,
      state.digitizer.max.x - state.digitizer.origin.x,
      state.digitizer.origin.y - state.digitizer.max.y
    );
    ctx.restore();
  }
}

function drawMarker(ctx, point, color, label) {
  if (!point) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 11px Helvetica Neue, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, point.x, point.y + 0.5);
  ctx.restore();
}

function clearDigitizer() {
  state.digitizer.origin = null;
  state.digitizer.max = null;
  state.digitizer.points = [];
  setDigitizerMode("origin");
  drawDigitizer();
  updateDigitizerOutput();
}

async function copyDigitizerCsv() {
  const csv = digitizerCsv();
  await copyText(csv);
  const status = $("#digitizer-status");
  status.textContent = state.digitizer.points.length
    ? "取点 CSV 已复制。请把原图来源、坐标范围和取点目的写入数据溯源。"
    : "尚无数据点，已复制表头。";
}

function updateDigitizerOutput() {
  $("#digitizer-output").textContent = digitizerCsv();
}

function digitizerCsv() {
  const rows = ["point,x,y,pixelX,pixelY"];
  state.digitizer.points.forEach((point, index) => {
    rows.push([
      index + 1,
      cleanNumber(point.valueX),
      cleanNumber(point.valueY),
      cleanNumber(point.x),
      cleanNumber(point.y)
    ].join(","));
  });
  return rows.join("\n");
}

function cleanNumber(value) {
  if (!Number.isFinite(Number(value))) return "";
  const text = Number(value).toPrecision(6);
  return text.includes(".") ? text.replace(/0+$/g, "").replace(/\.$/, "") : text;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

async function savePaperFromForm(form) {
  const payload = formToPaper(form);
  const method = payload.id ? "PATCH" : "POST";
  const url = payload.id ? `/api/papers/${encodeURIComponent(payload.id)}` : "/api/papers";
  return api(url, { method, body: JSON.stringify(payload) });
}

function fillEmptyNumber(input, value) {
  if (value === null || value === undefined || value === "" || input.value) return;
  input.value = Number(value);
}

function appendTextNote(current = "", note = "") {
  const parts = String(current)
    .split("；")
    .map((item) => item.trim())
    .filter(Boolean);
  if (note && !parts.includes(note)) parts.push(note);
  return parts.join("；");
}

function formToSettings(form) {
  return {
    lookbackDays: numberOrNull(form.lookbackDays.value),
    maxPerQuery: numberOrNull(form.maxPerQuery.value),
    ingestIntervalHours: numberOrNull(form.ingestIntervalHours.value),
    autoIngestEnabled: form.autoIngestEnabled.checked,
    fullTextEnabled: form.fullTextEnabled.checked,
    fullTextMaxPerRun: numberOrNull(form.fullTextMaxPerRun.value),
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

function evidenceLine(paper) {
  const evidence = paper.params?.evidence || paper.evidence || {};
  const labels = {
    ionUaPerUm: "Ion",
    rcOhmUm: "Rc",
    rcDefinition: "Rc口径",
    vdsV: "VDS",
    ssMvDec: "SS",
    logSwitchRatio: "开关比",
    ioffUaPerUm: "Ioff"
  };
  const entries = Object.entries(labels)
    .map(([key, label]) => {
      const item = evidence[key];
      if (!item?.snippet) return "";
      return evidenceMarkup(label, item);
    })
    .filter(Boolean)
    .slice(0, 3);
  if (!entries.length) return "";
  return `<div class="evidence"><strong>字段证据</strong>${entries.join("")}</div>`;
}

function evidenceMarkup(label, item) {
  const position = [
    item.source ? `来源 ${item.source}` : "",
    item.paragraph ? `第 ${item.paragraph} 段` : "",
    Number.isFinite(item.charStart) && Number.isFinite(item.charEnd) ? `全文字符 ${item.charStart}-${item.charEnd}` : "",
    Number.isFinite(item.paragraphCharStart) && Number.isFinite(item.paragraphCharEnd)
      ? `段内字符 ${item.paragraphCharStart}-${item.paragraphCharEnd}`
      : ""
  ]
    .filter(Boolean)
    .join(" · ");
  const context = highlightedContext(item);
  return `
    <div class="evidence-item">
      <span class="evidence-label">${escapeHtml(label)}</span>
      <span class="evidence-pos">${escapeHtml(position || "位置待定")}</span>
      <div class="evidence-context">${context || `<mark>${escapeHtml(item.snippet)}</mark>`}</div>
    </div>
  `;
}

function highlightedContext(item) {
  if (!item.paragraphText || !Number.isFinite(item.paragraphCharStart) || !Number.isFinite(item.paragraphCharEnd)) {
    return "";
  }
  const text = item.paragraphText;
  const start = Math.max(0, Math.min(item.paragraphCharStart, text.length));
  const end = Math.max(start, Math.min(item.paragraphCharEnd, text.length));
  const windowStart = Math.max(0, start - 90);
  const windowEnd = Math.min(text.length, end + 90);
  const prefix = windowStart > 0 ? "..." : "";
  const suffix = windowEnd < text.length ? "..." : "";
  return `${escapeHtml(prefix + text.slice(windowStart, start))}<mark>${escapeHtml(text.slice(start, end))}</mark>${escapeHtml(text.slice(end, windowEnd) + suffix)}`;
}

function actions(paper) {
  return `
    <div class="row-actions">
      ${rcReviewActions(paper)}
      ${loginImportAction(paper)}
      ${openPaperAction(paper)}
      <button class="secondary" data-edit="${escapeAttr(paper.id)}">编辑</button>
      <button class="ghost" data-delete="${escapeAttr(paper.id)}">删除</button>
    </div>
  `;
}

function loginImportAction(paper) {
  const url = paperAccessUrl(paper);
  if (!url) return "";
  return `<button class="row-action-link primary" data-login-import="${escapeAttr(paper.id)}">登录导入</button>`;
}

function openPaperAction(paper) {
  const url = paperAccessUrl(paper);
  if (!url) return "";
  return `<a class="row-action-link" href="${escapeAttr(url)}" target="_blank" rel="noreferrer">打开原文/登录</a>`;
}

function paperAccessUrl(paper = {}) {
  if (paper.url && /^https?:\/\//i.test(paper.url)) return paper.url;
  if (paper.doi) return `https://doi.org/${String(paper.doi).replace(/^https?:\/\/doi\.org\//i, "")}`;
  return "";
}

function startPendingLoginImport(paper) {
  const url = paperAccessUrl(paper);
  if (!url) return;
  const pending = {
    id: paper.id,
    title: paper.title || "",
    url,
    startedAt: new Date().toISOString()
  };
  localStorage.setItem(PENDING_IMPORT_KEY, JSON.stringify(pending));
  renderPendingImportCard();
  switchView("manual");
  $("#extract-text-status").textContent = `已进入自动导入模式：${paper.title || paper.id}。登录打开全文后，点击书签栏“导入到 Γ₂D”。`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function getPendingImport() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_IMPORT_KEY) || "null");
    if (!pending?.id) return null;
    return pending;
  } catch {
    return null;
  }
}

function clearPendingImport() {
  localStorage.removeItem(PENDING_IMPORT_KEY);
}

function rcReviewActions(paper) {
  const hasRc = paper.params?.rcOhmUm !== null && paper.params?.rcOhmUm !== undefined;
  const rcUnknown = !paper.params?.rcDefinition || paper.params.rcDefinition === "unknown";
  if (!hasRc || !rcUnknown) return "";
  return `
    <div class="quick-rc">
      <span>确认 Rc</span>
      <button class="mini" data-rc-id="${escapeAttr(paper.id)}" data-rc-value="total">总等效</button>
      <button class="mini ghost" data-rc-id="${escapeAttr(paper.id)}" data-rc-value="single">单侧</button>
    </div>
  `;
}

function classPill(label) {
  const klass = label.includes("裕量较充足")
    ? "good"
    : label.includes("接近边界")
      ? "warn"
      : label.includes("裕量不足")
        ? "bad"
        : "";
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

function phaseLabel(phase, running) {
  const labels = {
    idle: "空闲",
    starting: "准备中",
    searching: "检索中",
    filtering: "筛选中",
    reading_fulltext: "读取全文",
    extracting: "抽取参数",
    skipped: "跳过样本",
    calculated: "已计算",
    needs_review: "待补参数",
    source_error: "来源错误",
    finished: "已完成",
    failed: "失败"
  };
  return `${labels[phase] || phase || "未知"}${running ? " · 运行中" : ""}`;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function log(text) {
  $("#ingest-log").textContent = text;
}

function formatIngestSummary(summary) {
  const lines = [
    `开始：${summary.startedAt || "-"}`,
    `完成：${summary.finishedAt || "-"}`,
    `检索范围：${summary.fromDate || "-"} 至今`,
    `原始抓取：${summary.fetchedRaw ?? "-"} 条`,
    `重复跳过：${summary.duplicates ?? "-"} 条`,
    `相关命中：${summary.relevant ?? "-"} 条`,
    `开放全文读取：${summary.fullTextRead ?? "-"} / ${summary.fullTextAttempted ?? "-"} 篇`,
    `全文补充参数：${summary.fullTextHelped ?? "-"} 篇`,
    `无公式参数跳过：${summary.noParameters ?? "-"} 条`,
    `入库/更新：${summary.addedOrUpdated ?? "-"} 条`,
    `可直接计算：${summary.calculated ?? "-"} 条`,
    `待补参数：${summary.needsReview ?? "-"} 条`
  ];

  if (summary.errors?.length) {
    lines.push("", "接口错误：", ...summary.errors.map((error) => `- ${error}`));
  }

  if (summary.byQuery?.length) {
    lines.push("", "分关键词/来源明细：");
    for (const item of summary.byQuery) {
      const saved = item.sources?.reduce((sum, source) => sum + Number(source.saved || 0), 0) || 0;
      const fetched = item.sources?.reduce((sum, source) => sum + Number(source.fetched || 0), 0) || 0;
      const relevant = item.sources?.reduce((sum, source) => sum + Number(source.relevant || 0), 0) || 0;
      lines.push(`- ${item.query}: 抓取 ${fetched}，相关 ${relevant}，入库 ${saved}`);
    }
  }

  return lines.join("\n");
}

async function copyRankingJson() {
  if (!state.rankingOutput) await loadRankingOutput();
  const text = JSON.stringify(state.rankingOutput, null, 2);
  await copyText(text);
  $("#copy-ranking-json").textContent = "已复制";
  setTimeout(() => {
    $("#copy-ranking-json").textContent = "复制 JSON";
  }, 1400);
}

function downloadRankingCsv() {
  if (!state.rankingOutput) return;
  const fields = [
    "rank",
    "title",
    "authors",
    "year",
    "journal",
    "doi",
    "url",
    "material",
    "deviceType",
    "status",
    "sourceType",
    "relevanceScore",
    "ionUaPerUm",
    "ionMAPerUm",
    "rcOhmUm",
    "rcDefinition",
    "rcEffectiveOhmUm",
    "trialRcEffectiveOhmUm",
    "vdsV",
    "ssMvDec",
    "logSwitchRatio",
    "onOffRatio",
    "ioffUaPerUm",
    "pi2d",
    "contactDropV",
    "effectiveVoltageV",
    "trialContactDropV",
    "trialEffectiveVoltageV",
    "switchCostV",
    "gamma2d",
    "displayGamma2d",
    "gammaMode",
    "estimatedGamma2d",
    "estimatedContactDropV",
    "estimatedEffectiveVoltageV",
    "estimatedSwitchCostV",
    "estimateAssumptions",
    "rcDefinitionScenarios",
    "dataQualityScore",
    "reliabilityLabel",
    "extractionConfidence",
    "trialGamma2d",
    "trialRcAssumption",
    "marginClass",
    "canCalculateGamma",
    "canTrialGamma",
    "availableFields",
    "missingFields",
    "partialStage",
    "dataCompleteness",
    "dataTrace",
    "sourceTrace",
    "evidence",
    "provenance",
    "fieldProvenance"
  ];
  const csv = [
    fields.join(","),
    ...state.rankingOutput.rows.map((row) => fields.map((field) => csvValue(row[field])).join(","))
  ].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `switch-margin-ranking-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function csvValue(value) {
  const normalized =
    value && typeof value === "object"
      ? JSON.stringify(value)
      : Array.isArray(value)
        ? value.join("; ")
        : value ?? "";
  return `"${String(normalized).replace(/"/g, '""')}"`;
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
