const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_MAX_CHARS = 900000;
const DEFAULT_MAX_CHARS_PER_SOURCE = 350000;
const DEFAULT_MAX_SOURCES = 4;
const MIN_TEXT_CHARS = 1200;
const USER_AGENT = "SwitchMarginSite/0.1 (open full-text parameter extraction; mailto:example@example.com)";
let pdfParserPromise = null;

export async function readOpenFullText(paper = {}, options = {}) {
  const candidates = await fullTextCandidates(paper, options);
  const errors = [];
  const sources = [];
  const maxSources = Number(options.maxSources || DEFAULT_MAX_SOURCES);
  const maxChars = Number(options.maxChars || DEFAULT_MAX_CHARS);
  const maxCandidates = Number(options.maxCandidates || 10);
  let usedChars = 0;
  const visited = new Set();

  for (let index = 0; index < candidates.length && index < maxCandidates; index += 1) {
    const candidate = candidates[index];
    const candidateKey = candidate.url.replace(/#.*$/, "");
    if (visited.has(candidateKey)) continue;
    visited.add(candidateKey);
    try {
      const result = await fetchTextCandidate(candidate, options);
      if (result.discoveredLinks?.length) {
        for (const link of result.discoveredLinks) {
          addCandidate(candidates, link.url, link.source);
        }
        dedupeCandidatesInPlace(candidates);
      }
      if (result.text.length >= MIN_TEXT_CHARS) {
        const remaining = maxChars - usedChars;
        if (remaining <= 0) break;
        const text = result.text.slice(0, remaining);
        sources.push({
          source: result.source,
          url: candidate.url,
          chars: text.length,
          text: `\n\n===== ${result.source} =====\n\n${text}`
        });
        usedChars += text.length;
        if (sources.length >= maxSources || usedChars >= maxChars) break;
        continue;
      }
      errors.push(`${candidate.source}: text too short (${result.text.length})`);
    } catch (error) {
      errors.push(`${candidate.source}: ${error.message}`);
    }
  }

  if (sources.length) {
    const text = sources
      .map((source) => source.text || "")
      .join("\n\n")
      .trim();
    return {
      ok: true,
      source: sources.map((item) => item.source).join(" + "),
      url: sources[0].url,
      chars: text.length,
      text,
      attempted: candidates.length,
      sources: sources.map(({ text: _text, ...source }) => source),
      errors
    };
  }

  return {
    ok: false,
    source: "",
    url: "",
    chars: 0,
    text: "",
    attempted: candidates.length,
    errors
  };
}

async function fullTextCandidates(paper, options) {
  const candidates = [];

  for (const item of paper.fullTextUrls || []) {
    addCandidate(candidates, item.url || item, item.source || "open-location");
  }

  if (paper.url) addCandidate(candidates, paper.url, "paper URL");
  if (paper.doi) addCandidate(candidates, `https://doi.org/${paper.doi}`, "DOI landing");

  const arxivId = getArxivId(paper);
  if (arxivId) {
    addCandidate(candidates, `https://arxiv.org/html/${arxivId}`, "arXiv HTML");
    addCandidate(candidates, `https://ar5iv.labs.arxiv.org/html/${arxivId}`, "ar5iv HTML");
  }

  const unpaywall = await getUnpaywallCandidate(paper.doi, options);
  for (const item of unpaywall) addCandidate(candidates, item.url, item.source);

  return prioritizeCandidates(uniqueCandidates(candidates)).slice(0, Number(options.maxCandidates || 8));
}

async function getUnpaywallCandidate(doi, options) {
  if (!doi) return [];
  const email = options.unpaywallEmail || process.env.UNPAYWALL_EMAIL || "example@example.com";
  const url = new URL(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`);
  url.searchParams.set("email", email);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(Number(options.timeoutMs || DEFAULT_TIMEOUT_MS))
    });
    if (!response.ok) return [];
    const json = await response.json();
    const best = json.best_oa_location || {};
    return [
      { url: best.url_for_landing_page || best.url, source: "Unpaywall OA landing" },
      { url: best.url_for_pdf, source: "Unpaywall OA PDF" }
    ].filter((item) => item.url);
  } catch {
    return [];
  }
}

function addCandidate(candidates, rawUrl, source) {
  if (!rawUrl) return;
  const url = String(rawUrl).trim();
  if (!/^https?:\/\//i.test(url)) return;
  candidates.push({ url, source });
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((item) => {
    const key = item.url.replace(/#.*$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeCandidatesInPlace(candidates) {
  const next = prioritizeCandidates(uniqueCandidates(candidates));
  candidates.splice(0, candidates.length, ...next);
}

function prioritizeCandidates(candidates) {
  return candidates.slice().sort((a, b) => candidatePriority(b) - candidatePriority(a));
}

function candidatePriority(candidate = {}) {
  const text = `${candidate.source || ""} ${candidate.url || ""}`.toLowerCase();
  let score = 0;
  if (/supp|support|si|esm|extended|additional/.test(text)) score += 8;
  if (/\.pdf($|\?)/.test(text)) score += 3;
  if (/arxiv|ar5iv/.test(text)) score += 2;
  if (/landing|doi/.test(text)) score -= 1;
  return score;
}

async function fetchTextCandidate(candidate, options) {
  if (/\.pdf($|\?)/i.test(candidate.url)) {
    return fetchPdfCandidate(candidate, options);
  }

  const response = await fetch(candidate.url, {
    redirect: "follow",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5"
    },
    signal: AbortSignal.timeout(Number(options.timeoutMs || DEFAULT_TIMEOUT_MS))
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  const contentType = response.headers.get("content-type") || "";
  if (/pdf/i.test(contentType)) {
    return fetchPdfCandidate(candidate, options, response);
  }

  const maxChars = Number(options.maxCharsPerSource || DEFAULT_MAX_CHARS_PER_SOURCE);
  const raw = await response.text();
  const discoveredLinks = extractSupplementLinks(raw, response.url || candidate.url);
  const text = htmlToText(raw).slice(0, maxChars);
  return { source: candidate.source, text, discoveredLinks };
}

async function fetchPdfCandidate(candidate, options, existingResponse = null) {
  const pdfParse = await getPdfParser();
  if (!pdfParse) {
    throw new Error("PDF detected; optional pdf-parse parser is not installed");
  }

  const response =
    existingResponse ||
    (await fetch(candidate.url, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/pdf,*/*;q=0.5"
      },
      signal: AbortSignal.timeout(Number(options.timeoutMs || DEFAULT_TIMEOUT_MS))
    }));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  const maxChars = Number(options.maxCharsPerSource || DEFAULT_MAX_CHARS_PER_SOURCE);
  const maxBytes = Number(options.maxPdfBytes || 18 * 1024 * 1024);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength && contentLength > maxBytes) {
    throw new Error(`PDF too large (${contentLength} bytes)`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error(`PDF too large (${buffer.length} bytes)`);
  const parsed = await pdfParse(buffer);
  const text = normalizePdfText(parsed.text || "").slice(0, maxChars);
  return { source: `${candidate.source} PDF`, text };
}

async function getPdfParser() {
  if (!pdfParserPromise) {
    pdfParserPromise = import("pdf-parse")
      .then((module) => module.default || module)
      .catch(() => null);
  }
  return pdfParserPromise;
}

function normalizePdfText(text = "") {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToText(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|figcaption|caption)>/gi, "\n\n")
    .replace(/<\/(tr|th|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&mu;|&#956;|&#x3bc;/gi, "μ")
    .replace(/&Omega;|&#937;|&#x3a9;/gi, "Ω")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractSupplementLinks(html = "", baseUrl = "") {
  const links = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = decodeHtml(match[1] || "");
    const label = htmlToText(match[2] || "").slice(0, 160);
    const combined = `${href} ${label}`.toLowerCase();
    if (!/(supplement|supporting|additional|extended data|esm|\.pdf|\.docx?|\.xlsx?|\.csv)/i.test(combined)) continue;
    const url = resolveUrl(href, baseUrl);
    if (!url) continue;
    links.push({
      url,
      source: /pdf/i.test(combined) ? `discovered PDF: ${label || "supplement"}` : `discovered supplement: ${label || "link"}`
    });
  }
  return uniqueCandidates(links).slice(0, 8);
}

function resolveUrl(href = "", baseUrl = "") {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function getArxivId(paper = {}) {
  const source = [paper.url, paper.id, paper.sourceTrace].filter(Boolean).join(" ");
  const match = source.match(/arxiv(?:\.org\/(?:abs|html)\/|[-\s:])([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i);
  return match?.[1] || "";
}
