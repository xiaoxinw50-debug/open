import { calculatePaper } from "./calculator.js";
import { extractParams, inferDeviceType, inferMaterial, looksRelevant, relevanceScore } from "./extract.js";
import { getState, updateState, upsertPaper } from "./db.js";

const USER_AGENT = "SwitchMarginSite/0.1 (local research tool; mailto:example@example.com)";

export async function runIngestion(options = {}) {
  const state = await getState();
  const lookbackDays = Number(options.lookbackDays || state.lookbackDays || 180);
  const maxPerQuery = Number(options.maxPerQuery || state.maxPerQuery || 18);
  const queries = Array.isArray(options.queries) && options.queries.length ? options.queries : state.queries;
  const fromDate = dateDaysAgo(lookbackDays);
  const startedAt = new Date().toISOString();
  const seen = new Set();
  const results = [];
  const errors = [];
  const querySummaries = [];
  let fetchedRaw = 0;
  let relevantCount = 0;
  let duplicateCount = 0;

  for (const query of queries) {
    const sourceRuns = [
      { name: "OpenAlex", promise: fetchOpenAlex(query, fromDate, maxPerQuery) },
      { name: "Crossref", promise: fetchCrossref(query, fromDate, maxPerQuery) },
      { name: "arXiv", promise: fetchArxiv(query, maxPerQuery) }
    ];
    const querySummary = { query, sources: [] };
    const settled = await Promise.allSettled(sourceRuns.map((source) => source.promise));
    for (const [sourceIndex, item] of settled.entries()) {
      const sourceSummary = {
        source: sourceRuns[sourceIndex].name,
        fetched: 0,
        duplicates: 0,
        relevant: 0,
        saved: 0,
        calculated: 0,
        needsReview: 0
      };
      if (item.status === "rejected") {
        errors.push(`${query}: ${item.reason?.message || item.reason}`);
        querySummary.sources.push(sourceSummary);
        continue;
      }
      sourceSummary.fetched = item.value.length;
      fetchedRaw += item.value.length;
      for (const paper of item.value) {
        const key = paper.doi || paper.openAlexId || paper.title;
        if (!key || seen.has(key)) {
          sourceSummary.duplicates += 1;
          duplicateCount += 1;
          continue;
        }
        seen.add(key);
        const combinedText = [paper.title, paper.abstract, paper.journal, paper.publisher].filter(Boolean).join(" ");
        if (!looksRelevant(combinedText)) continue;
        sourceSummary.relevant += 1;
        relevantCount += 1;

        const extraction = extractParams(combinedText);
        const draft = {
          ...paper,
          id: paper.id,
          material: inferMaterial(combinedText),
          deviceType: inferDeviceType(combinedText),
          relevanceScore: relevanceScore(combinedText),
          status: "needs_review",
          params: extraction.params,
          sourceTrace: [
            paper.sourceTrace,
            `自动检索 ${paper.sourceName}；参数抽取置信度 ${extraction.extractionConfidence}`
          ]
            .filter(Boolean)
            .join(" | ")
        };

        const metrics = calculatePaper(draft);
        if (metrics.canCalculateGamma && extraction.extractionConfidence >= 0.8) {
          draft.status = "calculated";
          draft.params.rcDefinition = draft.params.rcDefinition === "unknown" ? "total" : draft.params.rcDefinition;
          draft.params.notes = `${draft.params.notes || ""}；自动计算前请复核 Rc 单侧/总接触口径。`;
        }

        const saved = await upsertPaper(draft);
        results.push(saved);
        sourceSummary.saved += 1;
        if (saved.metrics.canCalculateGamma) sourceSummary.calculated += 1;
        else sourceSummary.needsReview += 1;
      }
      querySummary.sources.push(sourceSummary);
    }
    querySummaries.push(querySummary);
  }

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    fromDate,
    queries,
    fetchedRaw,
    duplicates: duplicateCount,
    relevant: relevantCount,
    addedOrUpdated: results.length,
    calculated: results.filter((item) => item.metrics.canCalculateGamma).length,
    needsReview: results.filter((item) => !item.metrics.canCalculateGamma).length,
    errors,
    byQuery: querySummaries
  };
  await updateState({ lastRunAt: summary.finishedAt, lastRunSummary: summary });
  return summary;
}

async function fetchOpenAlex(query, fromDate, maxPerQuery) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("filter", `from_publication_date:${fromDate},type:article`);
  url.searchParams.set("sort", "publication_date:desc");
  url.searchParams.set("per-page", String(maxPerQuery));
  url.searchParams.set("mailto", "example@example.com");

  const json = await fetchJson(url);
  return (json.results || []).map((work) => {
    const title = strip(work.title || "");
    const abstract = invertedIndexToText(work.abstract_inverted_index);
    const year = work.publication_year || yearFromDate(work.publication_date);
    const journal = work.primary_location?.source?.display_name || "";
    const doi = work.doi ? work.doi.replace(/^https:\/\/doi.org\//i, "") : "";
    return {
      id: work.id?.replace(/^https:\/\/openalex.org\//, "openalex-"),
      openAlexId: work.id,
      title,
      abstract,
      authors: (work.authorships || [])
        .slice(0, 4)
        .map((item) => item.author?.display_name)
        .filter(Boolean)
        .join(", "),
      year,
      journal,
      doi,
      url: work.doi || work.id,
      publisher: work.primary_location?.source?.host_organization_name || "",
      sourceName: "OpenAlex",
      sourceType: "auto-openalex",
      sourceTrace: `OpenAlex ${work.id || ""}`
    };
  });
}

async function fetchCrossref(query, fromDate, maxPerQuery) {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("filter", `from-pub-date:${fromDate},type:journal-article`);
  url.searchParams.set("rows", String(maxPerQuery));
  url.searchParams.set("sort", "published");
  url.searchParams.set("order", "desc");

  const json = await fetchJson(url);
  return (json.message?.items || []).map((item) => {
    const title = strip(item.title?.[0] || "");
    const abstract = strip(item.abstract || "");
    const journal = item["container-title"]?.[0] || "";
    const year = yearFromCrossref(item);
    return {
      id: item.DOI ? `doi-${item.DOI.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined,
      title,
      abstract,
      authors: (item.author || [])
        .slice(0, 4)
        .map((author) => [author.given, author.family].filter(Boolean).join(" "))
        .filter(Boolean)
        .join(", "),
      year,
      journal,
      doi: item.DOI || "",
      url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ""),
      publisher: item.publisher || "",
      sourceName: "Crossref",
      sourceType: "auto-crossref",
      sourceTrace: `Crossref DOI ${item.DOI || "unknown"}`
    };
  });
}

async function fetchArxiv(query, maxPerQuery) {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", arxivQuery(query));
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(Math.min(maxPerQuery, 25)));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/atom+xml"
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url.hostname}`);
  }

  const xml = await response.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
    const entry = match[1];
    const title = stripXml(getXml(entry, "title"));
    const abstract = stripXml(getXml(entry, "summary"));
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)]
      .slice(0, 4)
      .map((author) => stripXml(author[1]))
      .filter(Boolean)
      .join(", ");
    const published = getXml(entry, "published");
    const id = stripXml(getXml(entry, "id"));
    const arxivId = id.split("/").pop() || id;
    return {
      id: `arxiv-${arxivId.replace(/[^a-zA-Z0-9.]+/g, "-")}`,
      title,
      abstract,
      authors,
      year: yearFromDate(published),
      journal: "arXiv",
      doi: "",
      url: id,
      publisher: "arXiv",
      sourceName: "arXiv",
      sourceType: "auto-arxiv",
      sourceTrace: `arXiv ${arxivId}`
    };
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url.hostname}`);
  }
  return response.json();
}

function invertedIndexToText(index) {
  if (!index) return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(" ");
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function yearFromDate(value) {
  return value ? Number(String(value).slice(0, 4)) : null;
}

function yearFromCrossref(item) {
  const parts =
    item["published-print"]?.["date-parts"] ||
    item["published-online"]?.["date-parts"] ||
    item.issued?.["date-parts"] ||
    item.created?.["date-parts"];
  return parts?.[0]?.[0] || null;
}

function strip(value = "") {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function arxivQuery(query) {
  const sourceOrVenueTerms = /^(nature|electronics|ieee|edl|electron|device|devices|letters|iedm|vlsi|conference)$/i;
  const terms = query
    .split(/\s+/)
    .map((term) => term.replace(/[^a-zA-Z0-9-]/g, ""))
    .filter((term) => term.length > 1 && !/^(and|or|the|for|with|of|in|on)$/i.test(term))
    .filter((term) => !sourceOrVenueTerms.test(term));

  const deviceTerms = terms.filter((term) => /^(transistor|fet|pfet|nfet|cmos|cfet|contact|resistance|semiconductor)$/i.test(term));
  const materialTerms = terms.filter((term) => /^(2d|two-dimensional|atomically|thin|van|der|waals|monolayer|mos2|wse2|mote2|tmd)$/i.test(term));
  const selected = [...materialTerms.slice(0, 3), ...deviceTerms.slice(0, 3)];
  const unique = [...new Set(selected.length ? selected : ["2D", "semiconductor", "transistor"])];

  return unique.map((term) => `all:${term}`).join(" AND ");
}

function getXml(entry, tag) {
  return entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "";
}

function stripXml(value = "") {
  return strip(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}
