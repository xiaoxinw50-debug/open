const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_MAX_CHARS = 250000;
const MIN_TEXT_CHARS = 1200;
const USER_AGENT = "SwitchMarginSite/0.1 (open full-text parameter extraction; mailto:example@example.com)";

export async function readOpenFullText(paper = {}, options = {}) {
  const candidates = await fullTextCandidates(paper, options);
  const errors = [];

  for (const candidate of candidates) {
    try {
      const result = await fetchTextCandidate(candidate, options);
      if (result.text.length >= MIN_TEXT_CHARS) {
        return {
          ok: true,
          source: result.source,
          url: candidate.url,
          chars: result.text.length,
          text: result.text,
          attempted: candidates.length,
          errors
        };
      }
      errors.push(`${candidate.source}: text too short (${result.text.length})`);
    } catch (error) {
      errors.push(`${candidate.source}: ${error.message}`);
    }
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

  const arxivId = getArxivId(paper);
  if (arxivId) {
    addCandidate(candidates, `https://arxiv.org/html/${arxivId}`, "arXiv HTML");
    addCandidate(candidates, `https://ar5iv.labs.arxiv.org/html/${arxivId}`, "ar5iv HTML");
  }

  const unpaywall = await getUnpaywallCandidate(paper.doi, options);
  for (const item of unpaywall) addCandidate(candidates, item.url, item.source);

  return uniqueCandidates(candidates).slice(0, Number(options.maxCandidates || 5));
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

async function fetchTextCandidate(candidate, options) {
  if (/\.pdf($|\?)/i.test(candidate.url)) {
    throw new Error("PDF detected; PDF full-text parsing is not enabled in this deployment");
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
    throw new Error("PDF response; PDF full-text parsing is not enabled in this deployment");
  }

  const maxChars = Number(options.maxChars || DEFAULT_MAX_CHARS);
  const raw = (await response.text()).slice(0, maxChars * 2);
  const text = htmlToText(raw).slice(0, maxChars);
  return { source: candidate.source, text };
}

export function htmlToText(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&mu;|&#956;|&#x3bc;/gi, "μ")
    .replace(/&Omega;|&#937;|&#x3a9;/gi, "Ω")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getArxivId(paper = {}) {
  const source = [paper.url, paper.id, paper.sourceTrace].filter(Boolean).join(" ");
  const match = source.match(/arxiv(?:\.org\/(?:abs|html)\/|[-\s:])([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i);
  return match?.[1] || "";
}
