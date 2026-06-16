export const DEFAULT_PI_REFERENCE = 0.7;
export const ESTIMATE_DEFAULTS = {
  rcDefinition: "total",
  vdsV: 1,
  ssMvDec: 100,
  logSwitchRatio: 7
};

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function round(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function getLogSwitchRatio(params = {}) {
  const directLog = toNumber(params.logSwitchRatio);
  if (directLog && directLog > 0) return directLog;

  const ratio = toNumber(params.onOffRatio);
  if (ratio && ratio > 1) return Math.log10(ratio);

  const ion = toNumber(params.ionUaPerUm);
  const ioff = toNumber(params.ioffUaPerUm);
  if (ion && ioff && ion > 0 && ioff > 0 && ion > ioff) return Math.log10(ion / ioff);

  return null;
}

export function getRcMultiplier(params = {}) {
  if (params.rcDefinition === "single") return 2;
  if (params.rcDefinition === "total") return 1;
  const custom = toNumber(params.rcMultiplier);
  if (custom && custom > 0) return custom;
  return null;
}

export function calculatePaper(paper = {}) {
  const params = paper.params || {};
  const ionUaPerUm = toNumber(params.ionUaPerUm);
  const rcOhmUm = toNumber(params.rcOhmUm);
  const ssMvDec = toNumber(params.ssMvDec);
  const vdsV = toNumber(params.vdsV);
  const logSwitchRatio = getLogSwitchRatio(params);
  const rcMultiplier = getRcMultiplier(params);

  const ionMAPerUm = ionUaPerUm === null ? null : ionUaPerUm / 1000;
  const rcKOhmUm = rcOhmUm === null ? null : rcOhmUm / 1000;
  const ssVDec = ssMvDec === null ? null : ssMvDec / 1000;

  const pi2d =
    ionMAPerUm !== null && rcKOhmUm !== null && rcKOhmUm > 0
      ? ionMAPerUm / rcKOhmUm
      : null;

  const normalizedPi =
    pi2d !== null && DEFAULT_PI_REFERENCE > 0 ? pi2d / DEFAULT_PI_REFERENCE : null;

  const effectiveRcKOhmUm =
    rcKOhmUm !== null && rcMultiplier !== null ? rcKOhmUm * rcMultiplier : null;
  const trialRcMultiplier =
    rcMultiplier !== null ? rcMultiplier : ionMAPerUm !== null && rcKOhmUm !== null ? 1 : null;
  const trialRcAssumption =
    rcMultiplier === null && trialRcMultiplier === 1 ? "Rc口径未知，试算按源漏总等效接触电阻处理" : "";
  const trialEffectiveRcKOhmUm =
    rcKOhmUm !== null && trialRcMultiplier !== null ? rcKOhmUm * trialRcMultiplier : null;

  const contactDropV =
    ionMAPerUm !== null && effectiveRcKOhmUm !== null
      ? ionMAPerUm * effectiveRcKOhmUm
      : null;
  const trialContactDropV =
    ionMAPerUm !== null && trialEffectiveRcKOhmUm !== null
      ? ionMAPerUm * trialEffectiveRcKOhmUm
      : null;

  const effectiveVoltageV =
    vdsV !== null && contactDropV !== null ? Math.abs(vdsV) - contactDropV : null;
  const trialEffectiveVoltageV =
    vdsV !== null && trialContactDropV !== null ? Math.abs(vdsV) - trialContactDropV : null;

  const switchCostV =
    ssVDec !== null && logSwitchRatio !== null ? ssVDec * logSwitchRatio : null;
  const rcDefinitionScenarios = calculateRcDefinitionScenarios({
    ionMAPerUm,
    rcKOhmUm,
    vdsV,
    switchCostV
  });

  const gamma2d =
    effectiveVoltageV !== null && switchCostV !== null && switchCostV > 0
      ? effectiveVoltageV / switchCostV
      : null;
  const trialGamma2d =
    gamma2d === null && trialEffectiveVoltageV !== null && switchCostV !== null && switchCostV > 0
      ? trialEffectiveVoltageV / switchCostV
      : null;
  const estimate = calculateEstimatedGamma({
    ionMAPerUm,
    rcKOhmUm,
    rcMultiplier,
    vdsV,
    ssMvDec,
    logSwitchRatio
  });

  const required = [
    ["Ion", ionUaPerUm],
    ["Rc", rcOhmUm],
    ["Rc口径", rcMultiplier],
    ["VDS", vdsV],
    ["SS", ssMvDec],
    ["开关比对数", logSwitchRatio]
  ];
  const missingFields = required.filter(([, value]) => value === null).map(([name]) => name);
  const canCalculateGamma = missingFields.length === 0;

  let marginClass = "待补参数";
  const judgmentGamma = gamma2d ?? estimate.gamma2d;
  if (judgmentGamma !== null) {
    const prefix = gamma2d === null ? "估算" : "";
    if (judgmentGamma >= 1.2) marginClass = `${prefix}裕量较充足`;
    else if (judgmentGamma >= 0.8) marginClass = `${prefix}接近边界`;
    else if (judgmentGamma >= 0) marginClass = `${prefix}裕量不足`;
    else marginClass = "裕量不足";
  }

  const dataCompleteness = round((required.length - missingFields.length) / required.length, 2);
  const gammaMode = gamma2d !== null ? "strict" : estimate.gamma2d !== null ? "estimated" : "missing";
  const dataQualityScore = getDataQualityScore({
    gammaMode,
    missingFields,
    estimateAssumptions: estimate.assumptions,
    trialGamma2d
  });
  const reliabilityLabel = getReliabilityLabel(gammaMode, dataQualityScore, trialGamma2d);
  const availableFields = required.filter(([, value]) => value !== null).map(([name]) => name);
  const partialStage = getPartialStage({
    gamma2d,
    trialGamma2d,
    pi2d,
    trialContactDropV,
    trialEffectiveVoltageV,
    switchCostV,
    missingFields,
    trialRcAssumption
  });

  return {
    pi2d: round(pi2d, 4),
    normalizedPi: round(normalizedPi, 3),
    ionMAPerUm: round(ionMAPerUm, 5),
    rcKOhmUm: round(rcKOhmUm, 5),
    effectiveRcKOhmUm: round(effectiveRcKOhmUm, 5),
    contactDropV: round(contactDropV, 4),
    effectiveVoltageV: round(effectiveVoltageV, 4),
    trialEffectiveRcKOhmUm: round(trialEffectiveRcKOhmUm, 5),
    trialContactDropV: round(trialContactDropV, 4),
    trialEffectiveVoltageV: round(trialEffectiveVoltageV, 4),
    switchCostV: round(switchCostV, 4),
    logSwitchRatio: round(logSwitchRatio, 3),
    gamma2d: round(gamma2d, 3),
    displayGamma2d: round(gamma2d ?? estimate.gamma2d, 3),
    gammaMode,
    estimatedGamma2d: round(estimate.gamma2d, 3),
    estimatedContactDropV: round(estimate.contactDropV, 4),
    estimatedEffectiveVoltageV: round(estimate.effectiveVoltageV, 4),
    estimatedSwitchCostV: round(estimate.switchCostV, 4),
    estimateAssumptions: estimate.assumptions,
    trialGamma2d: round(trialGamma2d, 3),
    trialRcAssumption,
    rcDefinitionScenarios,
    marginClass,
    canCalculateGamma,
    canTrialGamma: trialGamma2d !== null,
    availableFields,
    missingFields,
    dataCompleteness,
    dataQualityScore,
    reliabilityLabel,
    partialStage
  };
}

function calculateRcDefinitionScenarios({ ionMAPerUm, rcKOhmUm, vdsV, switchCostV }) {
  if (ionMAPerUm === null || rcKOhmUm === null) return null;
  const total = calculateRcScenario({ ionMAPerUm, rcKOhmUm, vdsV, switchCostV, multiplier: 1 });
  const single = calculateRcScenario({ ionMAPerUm, rcKOhmUm, vdsV, switchCostV, multiplier: 2 });
  const gammaDelta =
    total.gamma2d !== null && single.gamma2d !== null ? Math.abs(total.gamma2d - single.gamma2d) : null;
  const effectiveVoltageDelta =
    total.effectiveVoltageV !== null && single.effectiveVoltageV !== null
      ? Math.abs(total.effectiveVoltageV - single.effectiveVoltageV)
      : null;
  return {
    total,
    single,
    gammaDelta: round(gammaDelta, 3),
    effectiveVoltageDelta: round(effectiveVoltageDelta, 4),
    sensitivityLabel: getRcSensitivityLabel(gammaDelta, effectiveVoltageDelta)
  };
}

function calculateRcScenario({ ionMAPerUm, rcKOhmUm, vdsV, switchCostV, multiplier }) {
  const effectiveRcKOhmUm = rcKOhmUm * multiplier;
  const contactDropV = ionMAPerUm * effectiveRcKOhmUm;
  const effectiveVoltageV = vdsV !== null ? Math.abs(vdsV) - contactDropV : null;
  const gamma2d = effectiveVoltageV !== null && switchCostV !== null && switchCostV > 0
    ? effectiveVoltageV / switchCostV
    : null;
  return {
    rcDefinition: multiplier === 1 ? "total" : "single",
    effectiveRcKOhmUm: round(effectiveRcKOhmUm, 5),
    contactDropV: round(contactDropV, 4),
    effectiveVoltageV: round(effectiveVoltageV, 4),
    gamma2d: round(gamma2d, 3)
  };
}

function getRcSensitivityLabel(gammaDelta, effectiveVoltageDelta) {
  if (gammaDelta !== null) {
    if (gammaDelta >= 0.3) return "Rc口径对 Γ₂D 影响较大，必须查原文确认";
    if (gammaDelta >= 0.1) return "Rc口径对 Γ₂D 有明显影响，建议优先确认";
    return "Rc口径对 Γ₂D 影响较小，但仍需确认";
  }
  if (effectiveVoltageDelta !== null) {
    if (effectiveVoltageDelta >= 0.1) return "Rc口径会明显改变有效电压余量";
    return "Rc口径会改变接触压降，需确认";
  }
  return "已有 Ion/Rc，可比较 Rc 口径影响；仍缺 VDS 或开关代价";
}

function getDataQualityScore({ gammaMode, missingFields, estimateAssumptions, trialGamma2d }) {
  if (gammaMode === "strict") return 1;
  if (gammaMode === "estimated") {
    const assumptionPenalty = Math.min((estimateAssumptions || []).length * 0.16, 0.55);
    const missingPenalty = Math.min((missingFields || []).length * 0.06, 0.25);
    return round(Math.max(0.35, 0.82 - assumptionPenalty - missingPenalty), 2);
  }
  if (trialGamma2d !== null) return 0.55;
  return round(Math.max(0, 1 - ((missingFields || []).length / 6)), 2);
}

function getReliabilityLabel(gammaMode, dataQualityScore, trialGamma2d) {
  if (gammaMode === "strict") return "严格计算";
  if (gammaMode === "estimated") return `估算排序，可信度 ${Math.round((dataQualityScore || 0) * 100)}%`;
  if (trialGamma2d !== null) return "Rc口径试算，需人工确认";
  return `待补参数，完整度 ${Math.round((dataQualityScore || 0) * 100)}%`;
}

function getPartialStage(metrics) {
  if (metrics.gamma2d !== null) return "严格 Γ₂D 已计算";
  if (metrics.trialGamma2d !== null) return `可试算 Γ₂D：${metrics.trialRcAssumption}`;
  if (metrics.trialEffectiveVoltageV !== null) return "已得到 Ion、Rc、VDS，可试算接触压降；仍缺 SS 或开关比，不能计算 Γ₂D";
  if (metrics.pi2d !== null && metrics.switchCostV !== null) return "已得到 Ion/Rc 与 SS/开关比；仍缺 VDS 或 Rc口径，不能计算 Γ₂D";
  if (metrics.pi2d !== null) return "已得到 Ion 和 Rc，可计算 Π₂D；仍缺 VDS、SS 或开关比";
  if (metrics.switchCostV !== null) return "已得到 SS 和开关比，可计算开关电压代价；仍缺 Ion 或 Rc";
  if (metrics.missingFields.length < 6) return `已有部分字段，仍缺：${metrics.missingFields.join("、")}`;
  return "公式字段尚未抽到，需要人工补充或读取图表/补充材料";
}

function calculateEstimatedGamma({ ionMAPerUm, rcKOhmUm, rcMultiplier, vdsV, ssMvDec, logSwitchRatio }) {
  if (ionMAPerUm === null || rcKOhmUm === null) {
    return {
      gamma2d: null,
      contactDropV: null,
      effectiveVoltageV: null,
      switchCostV: null,
      assumptions: []
    };
  }

  const assumptions = [];
  const effectiveRcMultiplier = rcMultiplier ?? 1;
  if (rcMultiplier === null) assumptions.push("Rc口径未知，估算按源漏总等效处理");

  const effectiveVds = vdsV ?? ESTIMATE_DEFAULTS.vdsV;
  if (vdsV === null) assumptions.push(`未给出VDS，估算暂按 ${ESTIMATE_DEFAULTS.vdsV} V`);

  const effectiveSsMvDec = ssMvDec ?? ESTIMATE_DEFAULTS.ssMvDec;
  if (ssMvDec === null) assumptions.push(`未给出SS，估算暂按 ${ESTIMATE_DEFAULTS.ssMvDec} mV/dec`);

  const effectiveLogRatio = logSwitchRatio ?? ESTIMATE_DEFAULTS.logSwitchRatio;
  if (logSwitchRatio === null) assumptions.push(`未给出开关比，估算暂按 log10(Ion/Ioff)=${ESTIMATE_DEFAULTS.logSwitchRatio}`);

  const contactDropV = ionMAPerUm * rcKOhmUm * effectiveRcMultiplier;
  const effectiveVoltageV = Math.abs(effectiveVds) - contactDropV;
  const switchCostV = (effectiveSsMvDec / 1000) * effectiveLogRatio;
  const gamma2d = switchCostV > 0 ? effectiveVoltageV / switchCostV : null;

  return {
    gamma2d,
    contactDropV,
    effectiveVoltageV,
    switchCostV,
    assumptions
  };
}

export function withMetrics(paper) {
  return {
    ...paper,
    metrics: calculatePaper(paper)
  };
}
