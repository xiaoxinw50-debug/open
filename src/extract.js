const SUPERSCRIPT_MAP = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁻": "-"
};

const RELEVANT_MATERIALS = [
  "mos2",
  "molybdenum disulfide",
  "wse2",
  "mote2",
  "ws2",
  "mose2",
  "bi2o2se",
  "tmd",
  "tmc",
  "atomically thin",
  "van der waals",
  "monolayer",
  "nanosheet",
  "nanoribbon",
  "2d electronics",
  "2d material",
  "2d materials",
  "ultrathin semiconductor",
  "layered semiconductor",
  "transition-metal dichalcogenide",
  "transition metal dichalcogenide",
  "two-dimensional semiconductor",
  "2d semiconductor",
  "2-d semiconductor"
];

const RELEVANT_DEVICE_TERMS = [
  "transistor",
  "field-effect",
  "field effect",
  "fet",
  "pfet",
  "nfet",
  "cmos",
  "logic",
  "contact resistance",
  "subthreshold",
  "gate length",
  "channel length"
];

export function looksRelevant(text = "") {
  const lower = normalize(text).toLowerCase();
  const materialHit = RELEVANT_MATERIALS.some((term) => lower.includes(term));
  const deviceHit = RELEVANT_DEVICE_TERMS.some((term) => lower.includes(term));
  return materialHit && deviceHit;
}

export function relevanceScore(text = "") {
  const lower = normalize(text).toLowerCase();
  let score = 0;
  for (const term of RELEVANT_MATERIALS) {
    if (lower.includes(term)) score += 2;
  }
  for (const term of RELEVANT_DEVICE_TERMS) {
    if (lower.includes(term)) score += 1;
  }
  if (/nature|ieee|electron devices|iedm|vlsi|nano letters/.test(lower)) score += 2;
  return score;
}

export function extractParams(rawText = "") {
  const text = normalize(rawText);
  const notes = [];
  const evidence = {};

  const ion = pickValue(text, [
    {
      name: "Ion",
      regex:
        /(?:I\s*(?:[_{]\s*)?on\}?|on[-\s]?(?:state\s*)?current|drive current|current density|normalized current)[^.;,\n]{0,130}?(\d+(?:\.\d+)?)\s*(mA|μA|uA|A)\s*(?:\/|·|\sper\s)?\s*(?:μm|um)(?:\^-?1|[-−]1|⁻¹)?/gi,
      convert: (value, unit) => convertCurrentToUa(value, unit)
    },
    {
      name: "Ion",
      regex:
        /(\d+(?:\.\d+)?)\s*(mA|μA|uA|A)\s*(?:\/|·|\sper\s)?\s*(?:μm|um)(?:\^-?1|[-−]1|⁻¹)?[^.;,\n]{0,120}?(?:I\s*(?:[_{]\s*)?on\}?|on[-\s]?(?:state\s*)?current|drive current|current density)/gi,
      convert: (value, unit) => convertCurrentToUa(value, unit)
    }
  ], { mode: "max", min: 0, max: 50000 });
  if (ion.note) notes.push(ion.note);
  if (ion.evidence) evidence.ionUaPerUm = ion.evidence;

  const rc = pickValue(text, [
    {
      name: "Rc",
      regex:
        /(?:contact resistance|R\s*(?:[_{]\s*)?c\}?|Rc)[^.;,\n]{0,110}?(\d+(?:\.\d+)?)\s*(k?Ω|kohm|ohm)\s*(?:·|\*|-)?\s*(?:μm|um)/gi,
      convert: (value, unit) => (unit.toLowerCase().startsWith("k") ? value * 1000 : value)
    },
    {
      name: "Rc",
      regex:
        /(\d+(?:\.\d+)?)\s*(k?Ω|kohm|ohm)\s*(?:·|\*|-)?\s*(?:μm|um)[^.;,\n]{0,100}?(?:contact resistance|R\s*(?:[_{]\s*)?c\}?|Rc)/gi,
      convert: (value, unit) => (unit.toLowerCase().startsWith("k") ? value * 1000 : value)
    }
  ], { mode: "min", min: 0, max: 200000 });
  if (rc.note) notes.push(rc.note);
  if (rc.evidence) evidence.rcOhmUm = rc.evidence;
  const rcDefinition = inferRcDefinition(text, rc.value);
  if (rcDefinition !== "unknown") notes.push(`自动识别 Rc 口径: ${rcDefinition === "single" ? "单侧接触" : "源漏总等效"}`);
  if (rcDefinition !== "unknown") evidence.rcDefinition = { value: rcDefinition, snippet: "由全文语境自动判断，仍建议人工复核" };

  const ss = pickValue(text, [
    {
      name: "SS",
      regex:
        /(?:subthreshold swing|subthreshold slope|SS)[^.;,\n]{0,90}?(\d+(?:\.\d+)?)\s*mV\s*(?:\/|·|\sper\s)?\s*dec(?:ade)?(?:\^-?1|[-−]1|⁻¹)?/gi,
      convert: (value) => value
    },
    {
      name: "SS",
      regex:
        /(\d+(?:\.\d+)?)\s*mV\s*(?:\/|·|\sper\s)?\s*dec(?:ade)?(?:\^-?1|[-−]1|⁻¹)?[^.;,\n]{0,90}?(?:subthreshold swing|subthreshold slope|SS)/gi,
      convert: (value) => value
    }
  ], { mode: "min", min: 20, max: 2000 });
  if (ss.note) notes.push(ss.note);
  if (ss.evidence) evidence.ssMvDec = ss.evidence;

  const vds = pickValue(text, [
    {
      name: "VDS",
      regex: /(?:V\s*(?:[_{]\s*)?(?:DS|D)\}?|Vds|Vd|drain[-\s]?source voltage|drain voltage)[^.;,\n]{0,60}?(-?\d+(?:\.\d+)?)\s*V/gi,
      convert: (value) => Math.abs(value)
    },
    {
      name: "VDS",
      regex: /(?:at|under|with)\s+(?:V\s*(?:[_{]\s*)?(?:DS|D)\}?|Vds|Vd)\s*=?\s*(-?\d+(?:\.\d+)?)\s*V/gi,
      convert: (value) => Math.abs(value)
    }
  ], { mode: "first", min: 0, max: 20 });
  if (vds.note) notes.push(vds.note);
  if (vds.evidence) evidence.vdsV = vds.evidence;

  const logRatio = pickSwitchRatio(text);
  if (logRatio.note) notes.push(logRatio.note);
  if (logRatio.evidence) evidence.logSwitchRatio = logRatio.evidence;

  return {
    params: {
      ionUaPerUm: ion.value,
      rcOhmUm: rc.value,
      rcDefinition,
      vdsV: vds.value,
      ssMvDec: ss.value,
      logSwitchRatio: logRatio.value,
      notes: notes.join("；"),
      evidence
    },
    extractionNotes: notes,
    extractionConfidence: confidence([ion.value, rc.value, ss.value, vds.value, logRatio.value])
  };
}

export function inferMaterial(text = "") {
  const lower = normalize(text).toLowerCase();
  const pairs = [
    ["mos2", "MoS2"],
    ["molybdenum disulfide", "MoS2"],
    ["wse2", "WSe2"],
    ["mote2", "MoTe2"],
    ["mose2", "MoSe2"],
    ["ws2", "WS2"],
    ["bi2o2se", "Bi2O2Se"]
  ];
  return pairs.find(([key]) => lower.includes(key))?.[1] || "";
}

export function inferDeviceType(text = "") {
  const lower = normalize(text).toLowerCase();
  if (/\bpfet\b|p-type|p type|hole/.test(lower)) return "pFET";
  if (/\bnfet\b|n-type|n type|electron/.test(lower)) return "nFET";
  if (/cmos|cfet|complementary/.test(lower)) return "CMOS";
  return "";
}

function pickValue(text, patterns, options = {}) {
  const candidates = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      const value = Number(match[1]);
      const unit = match[2] || "";
      if (!Number.isFinite(value)) continue;
      const converted = pattern.convert(value, unit);
      if (Number.isFinite(converted) && inRange(converted, options)) {
        candidates.push({
          value: converted,
          raw: match[0].replace(/\s+/g, " ").slice(0, 160),
          name: pattern.name,
          index: match.index
        });
      }
    }
  }

  if (!candidates.length) return { value: null, note: "" };
  const sorted = candidates.slice().sort((a, b) => {
    if (options.mode === "min") return a.value - b.value || a.index - b.index;
    if (options.mode === "first") return a.index - b.index;
    return b.value - a.value || a.index - b.index;
  });
  const picked = sorted[0];
  return {
    value: picked.value,
    note: `自动识别 ${picked.name}: ${picked.raw}`,
    evidence: {
      value: picked.value,
      snippet: picked.raw,
      candidates: sorted.slice(0, 4).map((item) => item.raw)
    }
  };
}

function pickSwitchRatio(text) {
  const candidates = [];
  const plain = text
    .replace(/10\s*([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_match, power) => `10^${power.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (char) => SUPERSCRIPT_MAP[char] || char)}`)
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/g, (char) => SUPERSCRIPT_MAP[char] || char);
  const patterns = [
    /(?:on\/off|on-off|current ratio|switching ratio)[^.;,\n]{0,80}?10\s*(?:\^|\*\*)\s*(\d+(?:\.\d+)?)/gi,
    /10\s*(?:\^|\*\*)\s*(\d+(?:\.\d+)?)[^.;,\n]{0,80}?(?:on\/off|on-off|current ratio|switching ratio)/gi,
    /(?:on\/off|on-off|current ratio|switching ratio)[^.;,\n]{0,80}?(\d+(?:\.\d+)?)\s*(?:orders of magnitude|decades)/gi,
    /(?:Ion\/Ioff|I\s*(?:[_{]\s*)?on\}?\s*\/\s*I\s*(?:[_{]\s*)?off\}?)[^.;,\n]{0,90}?10\s*(?:\^|\*\*)\s*(\d+(?:\.\d+)?)/gi,
    /10\s*(?:\^|\*\*)\s*(\d+(?:\.\d+)?)[^.;,\n]{0,90}?(?:Ion\/Ioff|I\s*(?:[_{]\s*)?on\}?\s*\/\s*I\s*(?:[_{]\s*)?off\}?)/gi
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(plain)) !== null) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0 && value < 20) {
        candidates.push({
          value,
          raw: match[0].replace(/\s+/g, " ").slice(0, 160)
        });
      }
    }
  }

  if (!candidates.length) return { value: null, note: "" };
  const picked = candidates.sort((a, b) => b.value - a.value)[0];
  return {
    value: picked.value,
    note: `自动识别开关比对数: ${picked.raw}`,
    evidence: {
      value: picked.value,
      snippet: picked.raw,
      candidates: candidates.slice(0, 4).map((item) => item.raw)
    }
  };
}

function inRange(value, options = {}) {
  if (options.min !== undefined && value < options.min) return false;
  if (options.max !== undefined && value > options.max) return false;
  return true;
}

function confidence(values) {
  const hit = values.filter((value) => value !== null && value !== undefined).length;
  return Math.round((hit / values.length) * 100) / 100;
}

function convertCurrentToUa(value, unit) {
  const normalized = unit.toLowerCase();
  if (normalized === "ma") return value * 1000;
  if (normalized === "a") return value * 1000000;
  return value;
}

function inferRcDefinition(text, rcValue) {
  if (rcValue === null || rcValue === undefined) return "unknown";
  const lower = normalize(text).toLowerCase();
  if (
    /(?:per|each|single|one[-\s]?side|one)\s+(?:contact|electrode)/.test(lower) ||
    /(?:contact|electrode)[-\s]?specific/.test(lower) ||
    /single[-\s]?contact/.test(lower)
  ) {
    return "single";
  }
  if (
    /(?:total|source[-\s]?drain|source\s+and\s+drain|two[-\s]?contact|both\s+contacts)\s+(?:contact\s+)?resistance/.test(lower) ||
    /r\s*c\s*,?\s*(?:total|tot)/.test(lower)
  ) {
    return "total";
  }
  return "unknown";
}

function normalize(text) {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[−–—]/g, "-")
    .replace(/Ω/g, "Ω")
    .replace(/µ/g, "μ")
    .replace(/\bμ\s*m\b/gi, "μm")
    .replace(/\bu\s*m\b/gi, "um")
    .replace(/\bm\s*V\b/g, "mV")
    .replace(/\bμ\s*A\b/gi, "μA")
    .replace(/\bu\s*A\b/gi, "uA")
    .replace(/\bm\s*A\b/g, "mA")
    .replace(/\bA\s*\/\s*(μm|um)\b/gi, "A/μm")
    .replace(/\b(μA|uA|mA)\s*\/\s*(μm|um)\b/gi, "$1/μm")
    .replace(/\bΩ\s*(?:·|-)?\s*(μm|um)\b/gi, "Ω μm")
    .replace(/\bohm\s*(?:·|-)?\s*(μm|um)\b/gi, "ohm μm")
    .replace(/\s+/g, " ")
    .trim();
}
