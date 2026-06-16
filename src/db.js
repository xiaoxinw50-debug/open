import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { seedPapers } from "./seed.js";
import { withMetrics } from "./calculator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.SWITCH_MARGIN_DATA_DIR
  ? path.resolve(process.env.SWITCH_MARGIN_DATA_DIR)
  : path.join(ROOT, "data");
const PAPERS_PATH = path.join(DATA_DIR, "papers.json");
const STATE_PATH = path.join(DATA_DIR, "ingest-state.json");

const DEFAULT_STATE = {
  lastRunAt: null,
  lastRunSummary: null,
  lookbackDays: 180,
  autoIngestEnabled: true,
  ingestIntervalHours: 6,
  maxPerQuery: 30,
  fullTextEnabled: true,
  fullTextMaxPerRun: 18,
  queries: [
    "2D semiconductor transistor",
    "2D transistor",
    "atomically thin transistor",
    "van der Waals transistor",
    "monolayer semiconductor FET",
    "2D FET contact resistance",
    "two-dimensional semiconductor transistor contact resistance",
    "2D semiconductor logic transistor subthreshold swing",
    "two-dimensional CMOS transistor",
    "2D CFET transistor",
    "back end of line 2D transistor",
    "MoS2 transistor contact resistance short channel",
    "MoS2 FET contact resistance",
    "WSe2 pFET contact resistance",
    "WSe2 transistor p-type contact",
    "MoTe2 pFET transistor",
    "transition metal dichalcogenide CMOS transistor",
    "TMD transistor contact resistance",
    "IEEE Electron Device Letters 2D semiconductor transistor",
    "IEDM two-dimensional semiconductor transistor",
    "VLSI 2D semiconductor transistor",
    "Nature Electronics 2D semiconductor pFET"
  ]
};

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(PAPERS_PATH);
  } catch {
    await fs.writeFile(PAPERS_PATH, JSON.stringify(seedPapers, null, 2), "utf8");
  }
  try {
    await fs.access(STATE_PATH);
  } catch {
    await fs.writeFile(STATE_PATH, JSON.stringify(DEFAULT_STATE, null, 2), "utf8");
  }
}

async function readJson(file, fallback) {
  await ensureDataFiles();
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function listPapers() {
  const papers = await readJson(PAPERS_PATH, seedPapers);
  return papers.map(withMetrics);
}

export async function getPaper(id) {
  const papers = await listPapers();
  return papers.find((paper) => paper.id === id) || null;
}

export async function replacePapers(papers) {
  await writeJson(PAPERS_PATH, papers);
}

export async function upsertPaper(paper) {
  const papers = await readJson(PAPERS_PATH, seedPapers);
  const now = new Date().toISOString();
  const normalized = {
    ...paper,
    id: paper.id || makeId(paper),
    firstSeenAt: paper.firstSeenAt || now,
    updatedAt: now,
    params: paper.params || {}
  };

  const index = papers.findIndex((item) => samePaper(item, normalized));
  if (index >= 0) {
    const existing = papers[index];
    papers[index] = mergePaper(existing, normalized);
  } else {
    papers.push(normalized);
  }

  await replacePapers(papers);
  return withMetrics(index >= 0 ? papers[index] : normalized);
}

export async function updatePaper(id, patch) {
  const papers = await readJson(PAPERS_PATH, seedPapers);
  const index = papers.findIndex((item) => item.id === id);
  if (index < 0) return null;

  const existing = papers[index];
  const updated = {
    ...existing,
    ...patch,
    params: {
      ...(existing.params || {}),
      ...(patch.params || {})
    },
    updatedAt: new Date().toISOString()
  };

  papers[index] = updated;
  await replacePapers(papers);
  return withMetrics(updated);
}

export async function deletePaper(id) {
  const papers = await readJson(PAPERS_PATH, seedPapers);
  const next = papers.filter((item) => item.id !== id);
  await replacePapers(next);
  return next.length !== papers.length;
}

export async function getState() {
  const state = await readJson(STATE_PATH, DEFAULT_STATE);
  return {
    ...DEFAULT_STATE,
    ...state,
    lookbackDays: Number(process.env.INGEST_LOOKBACK_DAYS || state.lookbackDays || DEFAULT_STATE.lookbackDays),
    maxPerQuery: Number(process.env.INGEST_MAX_PER_QUERY || state.maxPerQuery || DEFAULT_STATE.maxPerQuery),
    fullTextEnabled:
      process.env.FULLTEXT_ENABLED === undefined
        ? Boolean(state.fullTextEnabled ?? DEFAULT_STATE.fullTextEnabled)
        : process.env.FULLTEXT_ENABLED !== "false",
    fullTextMaxPerRun: Number(
      process.env.FULLTEXT_MAX_PER_RUN || state.fullTextMaxPerRun || DEFAULT_STATE.fullTextMaxPerRun
    ),
    ingestIntervalHours: Number(
      process.env.INGEST_INTERVAL_HOURS || state.ingestIntervalHours || DEFAULT_STATE.ingestIntervalHours
    ),
    autoIngestEnabled:
      process.env.AUTO_INGEST_ENABLED === undefined
        ? Boolean(state.autoIngestEnabled ?? DEFAULT_STATE.autoIngestEnabled)
        : process.env.AUTO_INGEST_ENABLED !== "false"
  };
}

export async function updateState(patch) {
  const state = await getState();
  const next = { ...state, ...patch };
  await writeJson(STATE_PATH, next);
  return next;
}

export function makeId(paper) {
  const source = paper.doi || paper.openAlexId || paper.title || randomUUID();
  return source
    .toString()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 96);
}

function samePaper(a, b) {
  if (a.doi && b.doi && normalizeDoi(a.doi) === normalizeDoi(b.doi)) return true;
  if (a.openAlexId && b.openAlexId && a.openAlexId === b.openAlexId) return true;
  return normalizeTitle(a.title) && normalizeTitle(a.title) === normalizeTitle(b.title);
}

function mergePaper(existing, incoming) {
  const keepParams = existing.params || {};
  const newParams = incoming.params || {};
  const status =
    existing.status === "calculated" && incoming.status === "needs_review"
      ? existing.status
      : incoming.status || existing.status;
  return {
    ...existing,
    ...incoming,
    status,
    params: { ...newParams, ...removeNullish(keepParams) },
    sourceTrace: mergeTrace(existing.sourceTrace, incoming.sourceTrace),
    updatedAt: new Date().toISOString()
  };
}

function mergeTrace(...values) {
  const parts = values
    .filter(Boolean)
    .flatMap((value) => String(value).split(/\s+\|\s+/))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(parts)].join(" | ");
}

function removeNullish(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== null && value !== undefined && value !== "")
  );
}

function normalizeDoi(doi = "") {
  return doi.toLowerCase().replace(/^https?:\/\/doi.org\//, "").trim();
}

function normalizeTitle(title = "") {
  return title
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
