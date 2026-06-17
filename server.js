import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculatePaper, withMetrics } from "./src/calculator.js";
import { deletePaper, getPaper, getState, listPapers, updatePaper, updateState, upsertPaper } from "./src/db.js";
import { runIngestion } from "./src/ingest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 5177);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

let ingestRunning = false;
let ingestProgress = makeIdleProgress();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/api/papers", async (req, res, next) => {
  try {
    const status = req.query.status?.toString();
    const sort = req.query.sort?.toString() || "gamma";
    const includeLowValue = req.query.includeLowValue === "1" || req.query.includeLowValue === "true";
    const papers = await listPapers();
    const visible = includeLowValue ? papers : papers.filter((paper) => !isLowValueAutoCandidate(paper));
    const filtered = status ? visible.filter((paper) => paper.status === status) : visible;
    res.json(sortPapers(filtered, sort));
  } catch (error) {
    next(error);
  }
});

app.get("/api/papers/:id", async (req, res, next) => {
  try {
    const paper = await getPaper(req.params.id);
    if (!paper) return res.status(404).json({ error: "paper not found" });
    res.json(paper);
  } catch (error) {
    next(error);
  }
});

app.post("/api/papers", async (req, res, next) => {
  try {
    const saved = await upsertPaper(normalizePaperInput(req.body));
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/papers/:id", async (req, res, next) => {
  try {
    const saved = await updatePaper(req.params.id, normalizePaperInput(req.body));
    if (!saved) return res.status(404).json({ error: "paper not found" });
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/papers/:id/rc-definition", async (req, res, next) => {
  try {
    const rcDefinition = req.body?.rcDefinition;
    if (!["single", "total", "unknown"].includes(rcDefinition)) {
      return res.status(400).json({ error: "rcDefinition must be single, total, or unknown" });
    }
    const existing = await getPaper(req.params.id);
    if (!existing) return res.status(404).json({ error: "paper not found" });

    const notes = appendAuditNote(
      existing.params?.notes || "",
      `人工确认 Rc 口径为${rcDefinition === "single" ? "单侧接触" : rcDefinition === "total" ? "源漏总等效" : "未确定"}`
    );
    const nextPaper = {
      ...existing,
      params: {
        ...(existing.params || {}),
        rcDefinition,
        notes,
        provenance: {
          ...(existing.params?.provenance || {}),
          rcDefinition: "original"
        }
      }
    };
    const metrics = calculatePaper(nextPaper);
    const saved = await updatePaper(req.params.id, {
      status: metrics.canCalculateGamma ? "calculated" : existing.status,
      params: nextPaper.params
    });
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/papers/:id", async (req, res, next) => {
  try {
    const deleted = await deletePaper(req.params.id);
    if (!deleted) return res.status(404).json({ error: "paper not found" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/calculate", (req, res) => {
  const paper = normalizePaperInput(req.body);
  res.json(withMetrics(paper));
});

app.get("/api/state", async (_req, res, next) => {
  try {
    res.json(await getState());
  } catch (error) {
    next(error);
  }
});

app.get("/api/ingest/progress", (_req, res) => {
  res.json(ingestProgress);
});

app.patch("/api/state", async (req, res, next) => {
  try {
    const patch = {};
    if (Array.isArray(req.body.queries)) patch.queries = req.body.queries.filter(Boolean);
    if (req.body.lookbackDays !== undefined) patch.lookbackDays = Number(req.body.lookbackDays);
    if (req.body.maxPerQuery !== undefined) patch.maxPerQuery = Number(req.body.maxPerQuery);
    if (req.body.autoIngestEnabled !== undefined) patch.autoIngestEnabled = Boolean(req.body.autoIngestEnabled);
    if (req.body.ingestIntervalHours !== undefined) patch.ingestIntervalHours = Number(req.body.ingestIntervalHours);
    if (req.body.fullTextEnabled !== undefined) patch.fullTextEnabled = Boolean(req.body.fullTextEnabled);
    if (req.body.fullTextMaxPerRun !== undefined) patch.fullTextMaxPerRun = Number(req.body.fullTextMaxPerRun);
    res.json(await updateState(patch));
  } catch (error) {
    next(error);
  }
});

app.post("/api/ingest/run", async (req, res, next) => {
  if (!isAuthorizedIngest(req)) return res.status(403).json({ error: "invalid ingestion token" });
  if (ingestRunning) return res.status(409).json({ error: "ingestion already running", progress: ingestProgress });
  ingestRunning = true;
  resetIngestProgress("manual");
  try {
    const summary = await runIngestion(req.body || {}, updateIngestProgress);
    updateIngestProgress({
      running: false,
      phase: "finished",
      message: "检索完成",
      finishedAt: summary.finishedAt,
      summary
    });
    res.json(summary);
  } catch (error) {
    updateIngestProgress({
      running: false,
      phase: "failed",
      message: error.message || "检索失败",
      error: error.message || String(error),
      finishedAt: new Date().toISOString()
    });
    next(error);
  } finally {
    ingestRunning = false;
  }
});

app.get("/api/stats", async (_req, res, next) => {
  try {
    const allPapers = await listPapers();
    const papers = allPapers.filter((paper) => !isLowValueAutoCandidate(paper));
    const calculated = papers.filter((paper) => paper.metrics.canCalculateGamma);
    const estimable = papers.filter((paper) => paper.metrics.gammaMode === "estimated");
    const needsReview = papers.filter((paper) => paper.metrics.gammaMode === "missing");
    const top = calculated
      .slice()
      .sort((a, b) => (b.metrics.gamma2d ?? -Infinity) - (a.metrics.gamma2d ?? -Infinity))[0];
    res.json({
      total: papers.length,
      calculated: calculated.length,
      estimable: estimable.length,
      needsReview: needsReview.length,
      hiddenLowValue: allPapers.length - papers.length,
      top: top ? { title: top.title, gamma2d: top.metrics.gamma2d } : null
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/diagnostics", async (req, res, next) => {
  try {
    const includeLowValue = req.query.includeLowValue === "1" || req.query.includeLowValue === "true";
    const allPapers = await listPapers();
    const hidden = allPapers.filter(isLowValueAutoCandidate);
    const papers = includeLowValue ? allPapers : allPapers.filter((paper) => !isLowValueAutoCandidate(paper));
    const strict = papers.filter((paper) => paper.metrics.gammaMode === "strict");
    const estimated = papers.filter((paper) => paper.metrics.gammaMode === "estimated");
    const missing = papers.filter((paper) => paper.metrics.gammaMode === "missing");
    const notStrict = papers.filter((paper) => !paper.metrics.canCalculateGamma);
    const missingDistribution = fieldDistribution(notStrict);
    const availableDistribution = availableFieldDistribution(papers);
    const weakCoreCount = notStrict.filter((paper) =>
      paper.metrics.missingFields.includes("Ion") || paper.metrics.missingFields.includes("Rc")
    ).length;
    const rcDefinitionMissingCount = notStrict.filter((paper) => paper.metrics.missingFields.includes("Rc口径")).length;

    res.json({
      generatedAt: new Date().toISOString(),
      includeLowValue,
      totalStored: allPapers.length,
      visible: papers.length,
      hiddenLowValue: hidden.length,
      modeCounts: {
        strict: strict.length,
        estimated: estimated.length,
        missing: missing.length
      },
      strictRate: papers.length ? roundRatio(strict.length / papers.length) : 0,
      rankableRate: papers.length ? roundRatio((strict.length + estimated.length) / papers.length) : 0,
      weakCoreCount,
      rcDefinitionMissingCount,
      missingDistribution,
      availableDistribution,
      recommendations: buildDiagnosticsRecommendations({
        missingDistribution,
        weakCoreCount,
        rcDefinitionMissingCount,
        hiddenLowValue: hidden.length,
        totalVisible: papers.length
      }),
      examples: missing
        .slice()
        .sort((a, b) => (b.metrics.dataCompleteness || 0) - (a.metrics.dataCompleteness || 0) || (b.year || 0) - (a.year || 0))
        .slice(0, 5)
        .map((paper) => ({
          id: paper.id,
          title: paper.title,
          year: paper.year,
          sourceType: paper.sourceType,
          missingFields: paper.metrics.missingFields,
          availableFields: paper.metrics.availableFields,
          partialStage: paper.metrics.partialStage
        }))
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/rankings", async (req, res, next) => {
  try {
    const sort = req.query.sort?.toString() || "gamma";
    const include = req.query.include?.toString() || "rankable";
    const papers = await listPapers();
    const visiblePapers = papers.filter((paper) => !isLowValueAutoCandidate(paper));
    const filtered =
      include === "all"
        ? papers
        : include === "strict"
          ? papers.filter((paper) => paper.metrics.canCalculateGamma)
          : papers.filter((paper) => paper.metrics.gammaMode !== "missing");
    const rows = sortPapers(filtered, sort).map(toRankingRow);

    res.json({
      generatedAt: new Date().toISOString(),
      sort,
      include,
      totalPapers: papers.length,
      returned: rows.length,
      calculated: papers.filter((paper) => paper.metrics.canCalculateGamma).length,
      estimable: papers.filter((paper) => paper.metrics.gammaMode === "estimated").length,
      needsReview: visiblePapers.filter((paper) => paper.metrics.gammaMode === "missing").length,
      hiddenLowValue: papers.length - visiblePapers.length,
      rows: rows.map((row, index) => ({ rank: index + 1, ...row }))
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "internal server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Switch margin site running at http://localhost:${PORT}`);
});

if (process.env.AUTO_INGEST_SCHEDULE !== "false") {
  setTimeout(() => {
    if (process.env.AUTO_INGEST_ON_START !== "false") {
      runScheduledIngestionSafe("startup", true);
    }
  }, Number(process.env.STARTUP_INGEST_DELAY_MS || 15000));

  setInterval(() => {
    runScheduledIngestionSafe("interval", false);
  }, Number(process.env.SCHEDULE_CHECK_INTERVAL_MS || 10 * 60 * 1000));
}

function runScheduledIngestionSafe(reason, force) {
  runScheduledIngestion(reason, force).catch((error) => {
    console.error("scheduled ingestion launcher failed", error);
  });
}

async function runScheduledIngestion(reason, force) {
  const state = await getState();
  if (!state.autoIngestEnabled || ingestRunning) return;

  const lastRunAt = state.lastRunAt ? new Date(state.lastRunAt).getTime() : 0;
  const intervalMs = Math.max(Number(state.ingestIntervalHours || 12), 1) * 60 * 60 * 1000;
  if (!force && Date.now() - lastRunAt < intervalMs) return;

  ingestRunning = true;
  resetIngestProgress(reason);
  try {
    console.log(`starting ${reason} ingestion`);
    const summary = await runIngestion({}, updateIngestProgress);
    updateIngestProgress({
      running: false,
      phase: "finished",
      message: "后台检索完成",
      finishedAt: summary.finishedAt,
      summary
    });
    console.log(`${reason} ingestion finished`, summary);
  } catch (error) {
    updateIngestProgress({
      running: false,
      phase: "failed",
      message: error.message || "后台检索失败",
      error: error.message || String(error),
      finishedAt: new Date().toISOString()
    });
    console.error("scheduled ingestion failed", error);
  } finally {
    ingestRunning = false;
  }
}

function makeIdleProgress() {
  return {
    runId: null,
    running: false,
    reason: null,
    phase: "idle",
    message: "尚未开始检索",
    startedAt: null,
    finishedAt: null,
    updatedAt: new Date().toISOString(),
    percent: 0,
    totalUnits: 0,
    completedUnits: 0,
    currentQuery: "",
    currentSource: "",
    currentPaper: "",
    counters: {},
    recent: [],
    summary: null,
    error: null
  };
}

function resetIngestProgress(reason) {
  const now = new Date().toISOString();
  ingestProgress = {
    ...makeIdleProgress(),
    runId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    running: true,
    reason,
    phase: "starting",
    message: "准备开始检索",
    startedAt: now,
    updatedAt: now
  };
}

function updateIngestProgress(patch = {}) {
  const recent = patch.recent
    ? patch.recent.slice(0, 8)
    : patch.event
      ? [patch.event, ...(ingestProgress.recent || [])].slice(0, 8)
      : ingestProgress.recent || [];
  const completedUnits = patch.completedUnits ?? ingestProgress.completedUnits ?? 0;
  const totalUnits = patch.totalUnits ?? ingestProgress.totalUnits ?? 0;
  const computedPercent =
    totalUnits > 0 ? Math.max(0, Math.min(100, Math.round((completedUnits / totalUnits) * 100))) : ingestProgress.percent || 0;
  const percent = patch.percent ?? Math.max(ingestProgress.percent || 0, computedPercent);

  ingestProgress = {
    ...ingestProgress,
    ...patch,
    recent,
    completedUnits,
    totalUnits,
    percent,
    updatedAt: new Date().toISOString()
  };
}

function sortPapers(papers, sort) {
  const list = papers.slice();
  if (sort === "year") {
    return list.sort((a, b) => (b.year || 0) - (a.year || 0));
  }
  if (sort === "relevance") {
    return list.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  }
  if (sort === "pi") {
    return list.sort((a, b) => (b.metrics.pi2d ?? -Infinity) - (a.metrics.pi2d ?? -Infinity));
  }
  return list.sort((a, b) => {
    const modeRank = { strict: 0, estimated: 1, missing: 2 };
    const am = modeRank[a.metrics.gammaMode] ?? 3;
    const bm = modeRank[b.metrics.gammaMode] ?? 3;
    if (am !== bm) return am - bm;
    const ag = a.metrics.displayGamma2d;
    const bg = b.metrics.displayGamma2d;
    if (ag === null && bg === null) return (b.year || 0) - (a.year || 0);
    if (ag === null) return 1;
    if (bg === null) return -1;
    return bg - ag;
  });
}

function normalizePaperInput(body = {}) {
  const params = body.params || {};
  const paper = {
    ...body,
    status: body.status || "needs_review",
    sourceType: body.sourceType || "manual",
    params: {
      ionUaPerUm: numericOrNull(params.ionUaPerUm),
      rcOhmUm: numericOrNull(params.rcOhmUm),
      rcDefinition: params.rcDefinition || "unknown",
      rcMultiplier: numericOrNull(params.rcMultiplier),
      vdsV: numericOrNull(params.vdsV),
      ssMvDec: numericOrNull(params.ssMvDec),
      logSwitchRatio: numericOrNull(params.logSwitchRatio),
      onOffRatio: numericOrNull(params.onOffRatio),
      ioffUaPerUm: numericOrNull(params.ioffUaPerUm),
      notes: params.notes || "",
      evidence: params.evidence || {},
      provenance: params.provenance || {}
    }
  };
  const metrics = calculatePaper(paper);
  if (body.status === undefined && metrics.canCalculateGamma) paper.status = "calculated";
  return paper;
}

function numericOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function appendAuditNote(notes = "", note = "") {
  const parts = String(notes)
    .split("；")
    .map((item) => item.trim())
    .filter(Boolean);
  if (note && !parts.includes(note)) parts.push(note);
  return parts.join("；");
}

function toRankingRow(paper) {
  const params = paper.params || {};
  const metrics = paper.metrics || calculatePaper(paper);
  return {
    id: paper.id,
    title: paper.title || "",
    authors: paper.authors || "",
    year: paper.year ?? null,
    journal: paper.journal || "",
    doi: paper.doi || "",
    url: paper.url || "",
    material: paper.material || "",
    deviceType: paper.deviceType || "",
    status: paper.status || "",
    sourceType: paper.sourceType || "",
    extractionConfidence: paper.extractionConfidence ?? null,
    relevanceScore: paper.relevanceScore ?? null,
    sourceTrace: paper.sourceTrace || "",
    dataTrace: params.notes || "",
    evidence: params.evidence || {},
    provenance: params.provenance || {},
    fieldProvenance: metrics.fieldProvenance || {},
    ionUaPerUm: params.ionUaPerUm ?? null,
    ionMAPerUm: metrics.ionMAPerUm,
    rcOhmUm: params.rcOhmUm ?? null,
    rcDefinition: params.rcDefinition || "unknown",
    rcEffectiveOhmUm: metrics.effectiveRcKOhmUm == null ? null : metrics.effectiveRcKOhmUm * 1000,
    trialRcEffectiveOhmUm: metrics.trialEffectiveRcKOhmUm == null ? null : metrics.trialEffectiveRcKOhmUm * 1000,
    vdsV: params.vdsV ?? null,
    ssMvDec: params.ssMvDec ?? null,
    logSwitchRatio: metrics.logSwitchRatio,
    onOffRatio: params.onOffRatio ?? null,
    ioffUaPerUm: params.ioffUaPerUm ?? null,
    pi2d: metrics.pi2d,
    contactDropV: metrics.contactDropV,
    effectiveVoltageV: metrics.effectiveVoltageV,
    trialContactDropV: metrics.trialContactDropV,
    trialEffectiveVoltageV: metrics.trialEffectiveVoltageV,
    switchCostV: metrics.switchCostV,
    gamma2d: metrics.gamma2d,
    displayGamma2d: metrics.displayGamma2d,
    gammaMode: metrics.gammaMode,
    estimatedGamma2d: metrics.estimatedGamma2d,
    estimatedContactDropV: metrics.estimatedContactDropV,
    estimatedEffectiveVoltageV: metrics.estimatedEffectiveVoltageV,
    estimatedSwitchCostV: metrics.estimatedSwitchCostV,
    estimateAssumptions: metrics.estimateAssumptions,
    trialGamma2d: metrics.trialGamma2d,
    trialRcAssumption: metrics.trialRcAssumption,
    rcDefinitionScenarios: metrics.rcDefinitionScenarios,
    marginClass: metrics.marginClass,
    canCalculateGamma: metrics.canCalculateGamma,
    canTrialGamma: metrics.canTrialGamma,
    availableFields: metrics.availableFields,
    missingFields: metrics.missingFields,
    dataCompleteness: metrics.dataCompleteness,
    dataQualityScore: metrics.dataQualityScore,
    reliabilityLabel: metrics.reliabilityLabel,
    partialStage: metrics.partialStage
  };
}

function fieldDistribution(papers) {
  const counts = new Map();
  for (const paper of papers) {
    for (const field of paper.metrics.missingFields || []) {
      counts.set(field, (counts.get(field) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field, "zh-CN"));
}

function availableFieldDistribution(papers) {
  const counts = new Map();
  for (const paper of papers) {
    for (const field of paper.metrics.availableFields || []) {
      counts.set(field, (counts.get(field) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field, "zh-CN"));
}

function buildDiagnosticsRecommendations({ missingDistribution, weakCoreCount, rcDefinitionMissingCount, hiddenLowValue, totalVisible }) {
  const top = missingDistribution[0];
  const recommendations = [];
  if (weakCoreCount > 0) {
    recommendations.push(`优先补 Ion/Rc：${weakCoreCount} 篇候选缺少至少一个核心排序字段，通常要看器件表、接触工程图或输出曲线。`);
  }
  if (rcDefinitionMissingCount > 0) {
    recommendations.push(`优先核对 Rc 口径：${rcDefinitionMissingCount} 篇缺少单侧/总等效说明，这会直接影响接触压降；可在表格操作列快速标记。`);
  }
  if (top) {
    recommendations.push(`当前最大瓶颈是 ${top.field}，影响 ${top.count} 篇非严格样本。`);
  }
  if (hiddenLowValue > 0) {
    recommendations.push(`已隐藏 ${hiddenLowValue} 条低价值自动候选；需要排查检索噪声时可临时显示。`);
  }
  if (!totalVisible) {
    recommendations.push("当前没有可见样本，需要先运行自动检索或手动录入基准论文。");
  }
  return recommendations;
}

function roundRatio(value) {
  return Math.round(value * 1000) / 1000;
}

function isAuthorizedIngest(req) {
  const token = process.env.INGEST_TOKEN;
  if (!token) return true;
  const provided = req.get("x-ingest-token") || req.query.token;
  return provided === token;
}

function isLowValueAutoCandidate(paper = {}) {
  if (!String(paper.sourceType || "").startsWith("auto")) return false;
  const metrics = paper.metrics || calculatePaper(paper);
  if (metrics.gammaMode !== "missing") return false;
  const params = paper.params || {};
  const hasCore = params.ionUaPerUm !== null && params.ionUaPerUm !== undefined ||
    params.rcOhmUm !== null && params.rcOhmUm !== undefined;
  if (hasCore) return false;
  const fields = metrics.availableFields || [];
  if (fields.length <= 1) return true;
  const text = `${paper.title || ""} ${paper.abstract || ""} ${paper.journal || ""}`.toLowerCase();
  return /review|perspective|outlook|prospect|phototransistor|photodetector|memrist|memory|sensor|sensing|non-volatile|nonvolatile/.test(text);
}
