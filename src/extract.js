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

  const ion = pickValue(text, [
    {
      name: "Ion",
      regex:
        /(?:I\s*on|Ion|on[-\s]?(?:state\s*)?current|drive current|current density|normalized current)[^.;,\n]{0,110}?(\d+(?:\.\d+)?)\s*(mA|μA|uA|A)\s*(?:\/|·|\sper\s)?\s*μ?m(?:\^-?1|[-−]1|⁻¹)?/gi,
      convert: (value, unit) => convertCurrentToUa(value, unit)
    },
    {
      name: "Ion",
      regex:
        /(\d+(?:\.\d+)?)\s*(mA|μA|uA|A)\s*(?:\/|·|\sper\s)?\s*μ?m(?:\^-?1|[-−]1|⁻¹)?[^.;,\n]{0,100}?(?:I\s*on|Ion|on[-\s]?(?:state\s*)?current|drive current|current density)/gi,
      convert: (value, unit) => convertCurrentToUa(value, unit)
    }
  ]);
  if (ion.note) notes.push(ion.note);

  const rc = pickValue(text, [
    {
      name: "Rc",
      regex:
        /(?:contact resistance|R\s*c|Rc)[^.;,\n]{0,90}?(\d+(?:\.\d+)?)\s*(k?Ω|kohm|ohm)\s*(?:·|\*)?\s*μ?m/gi,
      convert: (value, unit) => (unit.toLowerCase().startsWith("k") ? value * 1000 : value)
    },
    {
      name: "Rc",
      regex:
        /(\d+(?:\.\d+)?)\s*(k?Ω|kohm|ohm)\s*(?:·|\*)?\s*μ?m[^.;,\n]{0,80}?(?:contact resistance|R\s*c|Rc)/gi,
      convert: (value, unit) => (unit.toLowerCase().startsWith("k") ? value * 1000 : value)
    }
  ]);
  if (rc.note) notes.push(rc.note);
  const rcDefinition = inferRcDefinition(text, rc.value);
  if (rcDefinition !== "unknown") notes.push(`自动识别 Rc 口径: ${rcDefinition === "single" ? "单侧接触" : "源漏总等效"}`);

  const ss = pickValue(text, [
    {
      name: "SS",
      regex:
        /(?:subthreshold swing|subthreshold slope|SS)[^.;,\n]{0,80}?(\d+(?:\.\d+)?)\s*mV\s*(?:\/|·|\sper\s)?\s*dec(?:ade)?/gi,
      convert: (value) => value
    },
    {
      name: "SS",
      regex:
        /(\d+(?:\.\d+)?)\s*mV\s*(?:\/|·|\sper\s)?\s*dec(?:ade)?[^.;,\n]{0,80}?(?:subthreshold swing|subthreshold slope|SS)/gi,
      convert: (value) => value
    }
  ]);
  if (ss.note) notes.push(ss.note);

  const vds = pickValue(text, [
    {
      name: "VDS",
      regex: /(?:V\s*DS|V\s*D|Vds|Vd|drain[-\s]?source voltage|drain voltage)[^.;,\n]{0,50}?(-?\d+(?:\.\d+)?)\s*V/gi,
      convert: (value) => Math.abs(value)
    },
    {
      name: "VDS",
      regex: /(?:at|under|with)\s+(?:V\s*DS|V\s*D|Vds|Vd)\s*=?\s*(-?\d+(?:\.\d+)?)\s*V/gi,
      convert: (value) => Math.abs(value)
    }
  ]);
  if (vds.note) notes.push(vds.note);

  const logRatio = pickSwitchRatio(text);
  if (logRatio.note) notes.push(logRatio.note);

  return {
    params: {
      ionUaPerUm: ion.value,
      rcOhmUm: rc.value,
      rcDefinition,
      vdsV: vds.value,
      ssMvDec: ss.value,
      logSwitchRatio: logRatio.value,
      notes: notes.join("；")
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

function pickValue(text, patterns) {
  const candidates = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      const value = Number(match[1]);
      const unit = match[2] || "";
      if (!Number.isFinite(value)) continue;
      const converted = pattern.convert(value, unit);
      if (Number.isFinite(converted)) {
        candidates.push({
          value: converted,
          raw: match[0].replace(/\s+/g, " ").slice(0, 160),
          name: pattern.name
        });
      }
    }
  }

  if (!candidates.length) return { value: null, note: "" };
  const picked = candidates.sort((a, b) => b.value - a.value)[0];
  return {
    value: picked.value,
    note: `自动识别 ${picked.name}: ${picked.raw}`
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
    /(?:Ion\/Ioff|I\s*on\s*\/\s*I\s*off)[^.;,\n]{0,80}?10\s*(?:\^|\*\*)\s*(\d+(?:\.\d+)?)/gi
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
    note: `自动识别开关比对数: ${picked.raw}`
  };
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
    .replace(/µ/g, "μ")
    .replace(/\bμ\s*A\b/gi, "μA")
    .replace(/\bu\s*A\b/gi, "uA")
    .replace(/\bm\s*A\b/g, "mA")
    .replace(/\bA\s*\/\s*μ\s*m\b/g, "A/μm")
    .replace(/\b(μA|uA|mA)\s*\/\s*μ\s*m\b/gi, "$1/μm")
    .replace(/\bΩ\s*μ\s*m\b/g, "Ω μm")
    .replace(/\bohm\s*μ\s*m\b/gi, "ohm μm")
    .replace(/\s+/g, " ")
    .trim();
}
