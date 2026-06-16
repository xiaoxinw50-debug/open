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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/api/papers", async (req, res, next) => {
  try {
    const status = req.query.status?.toString();
    const sort = req.query.sort?.toString() || "gamma";
    const papers = await listPapers();
    const filtered = status ? papers.filter((paper) => paper.status === status) : papers;
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
  if (ingestRunning) return res.status(409).json({ error: "ingestion already running" });
  ingestRunning = true;
  try {
    const summary = await runIngestion(req.body || {});
    res.json(summary);
  } catch (error) {
    next(error);
  } finally {
    ingestRunning = false;
  }
});

app.get("/api/stats", async (_req, res, next) => {
  try {
    const papers = await listPapers();
    const calculated = papers.filter((paper) => paper.metrics.canCalculateGamma);
    const needsReview = papers.filter((paper) => !paper.metrics.canCalculateGamma);
    const top = calculated
      .slice()
      .sort((a, b) => (b.metrics.gamma2d ?? -Infinity) - (a.metrics.gamma2d ?? -Infinity))[0];
    res.json({
      total: papers.length,
      calculated: calculated.length,
      needsReview: needsReview.length,
      top: top ? { title: top.title, gamma2d: top.metrics.gamma2d } : null
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/rankings", async (req, res, next) => {
  try {
    const sort = req.query.sort?.toString() || "gamma";
    const include = req.query.include?.toString() || "calculated";
    const papers = await listPapers();
    const filtered = include === "all" ? papers : papers.filter((paper) => paper.metrics.canCalculateGamma);
    const rows = sortPapers(filtered, sort).map(toRankingRow);

    res.json({
      generatedAt: new Date().toISOString(),
      sort,
      include,
      totalPapers: papers.length,
      returned: rows.length,
      calculated: papers.filter((paper) => paper.metrics.canCalculateGamma).length,
      needsReview: papers.filter((paper) => !paper.metrics.canCalculateGamma).length,
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

setTimeout(() => {
  if (process.env.AUTO_INGEST_ON_START !== "false") {
    runScheduledIngestion("startup", true);
  }
}, Number(process.env.STARTUP_INGEST_DELAY_MS || 15000));

setInterval(async () => {
  runScheduledIngestion("interval", false);
}, Number(process.env.SCHEDULE_CHECK_INTERVAL_MS || 10 * 60 * 1000));

async function runScheduledIngestion(reason, force) {
  const state = await getState();
  if (!state.autoIngestEnabled || ingestRunning) return;

  const lastRunAt = state.lastRunAt ? new Date(state.lastRunAt).getTime() : 0;
  const intervalMs = Math.max(Number(state.ingestIntervalHours || 12), 1) * 60 * 60 * 1000;
  if (!force && Date.now() - lastRunAt < intervalMs) return;

  ingestRunning = true;
  try {
    console.log(`starting ${reason} ingestion`);
    const summary = await runIngestion();
    console.log(`${reason} ingestion finished`, summary);
  } catch (error) {
    console.error("scheduled ingestion failed", error);
  } finally {
    ingestRunning = false;
  }
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
    const ag = a.metrics.gamma2d;
    const bg = b.metrics.gamma2d;
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
      notes: params.notes || ""
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
    relevanceScore: paper.relevanceScore ?? null,
    sourceTrace: paper.sourceTrace || "",
    dataTrace: params.notes || "",
    evidence: params.evidence || {},
    ionUaPerUm: params.ionUaPerUm ?? null,
    ionMAPerUm: metrics.ionMAPerUm,
    rcOhmUm: params.rcOhmUm ?? null,
    rcDefinition: params.rcDefinition || "unknown",
    rcEffectiveOhmUm: metrics.effectiveRcKOhmUm == null ? null : metrics.effectiveRcKOhmUm * 1000,
    vdsV: params.vdsV ?? null,
    ssMvDec: params.ssMvDec ?? null,
    logSwitchRatio: metrics.logSwitchRatio,
    onOffRatio: params.onOffRatio ?? null,
    pi2d: metrics.pi2d,
    contactDropV: metrics.contactDropV,
    effectiveVoltageV: metrics.effectiveVoltageV,
    switchCostV: metrics.switchCostV,
    gamma2d: metrics.gamma2d,
    marginClass: metrics.marginClass,
    canCalculateGamma: metrics.canCalculateGamma,
    missingFields: metrics.missingFields,
    dataCompleteness: metrics.dataCompleteness
  };
}

function isAuthorizedIngest(req) {
  const token = process.env.INGEST_TOKEN;
  if (!token) return true;
  const provided = req.get("x-ingest-token") || req.query.token;
  return provided === token;
}
