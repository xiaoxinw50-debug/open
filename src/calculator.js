export const DEFAULT_PI_REFERENCE = 0.7;

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

  const contactDropV =
    ionMAPerUm !== null && effectiveRcKOhmUm !== null
      ? ionMAPerUm * effectiveRcKOhmUm
      : null;

  const effectiveVoltageV =
    vdsV !== null && contactDropV !== null ? Math.abs(vdsV) - contactDropV : null;

  const switchCostV =
    ssVDec !== null && logSwitchRatio !== null ? ssVDec * logSwitchRatio : null;

  const gamma2d =
    effectiveVoltageV !== null && switchCostV !== null && switchCostV > 0
      ? effectiveVoltageV / switchCostV
      : null;

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
  if (gamma2d !== null) {
    if (gamma2d >= 1.2) marginClass = "裕量较充足";
    else if (gamma2d >= 0.8) marginClass = "接近边界";
    else marginClass = "裕量不足";
  }

  const dataCompleteness = round((required.length - missingFields.length) / required.length, 2);

  return {
    pi2d: round(pi2d, 4),
    normalizedPi: round(normalizedPi, 3),
    ionMAPerUm: round(ionMAPerUm, 5),
    rcKOhmUm: round(rcKOhmUm, 5),
    effectiveRcKOhmUm: round(effectiveRcKOhmUm, 5),
    contactDropV: round(contactDropV, 4),
    effectiveVoltageV: round(effectiveVoltageV, 4),
    switchCostV: round(switchCostV, 4),
    logSwitchRatio: round(logSwitchRatio, 3),
    gamma2d: round(gamma2d, 3),
    marginClass,
    canCalculateGamma,
    missingFields,
    dataCompleteness
  };
}

export function withMetrics(paper) {
  return {
    ...paper,
    metrics: calculatePaper(paper)
  };
}
