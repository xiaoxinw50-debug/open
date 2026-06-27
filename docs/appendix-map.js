const APPENDIX_EDIT_KEY = "paperViz.appendixMap.v1";

const appendixDefaultMap = {
  thesis: "开关裕量因子不是新的物理常数，而是把接触损耗、栅控代价和开关窗口放回同一供电预算中的辅助判读尺度。",
  stages: [
    {
      phase: "提出问题",
      title: "单项最好值不能直接说明逻辑可用性",
      route: { section: "s10" },
      role: "开态电流、接触电阻、SS 和开关比常在不同偏压、不同尺寸或不同器件上报告。若直接横向比较，容易把局部最优误读为完整器件优势。",
      nodes: [
        { label: "开态电流高不等于裕量高", route: { section: "s10" } },
        { label: "接触电阻低要看接触长度", route: { section: "s13" } },
        { label: "SS 要说明取值方式", route: { section: "s11" } },
        { label: "开关比必须回到窗口", route: { section: "s11" } }
      ]
    },
    {
      phase: "物理拆分",
      title: "把器件工作拆成供电预算中的两类电压",
      route: { section: "s11" },
      role: "漏源端提供驱动，接触消耗其中一部分；栅极端负责把电流从关态推到开态。二者都可落到电压预算中讨论，但必须说明端口含义和换算口径。",
      nodes: [
        { label: "接触压降", route: { q: "接触压降" } },
        { label: "有效驱动电压余量", route: { section: "s11" } },
        { label: "栅压开关代价", route: { section: "s11" } },
        { label: "同一供电约束下比较", route: { section: "s11" } }
      ]
    },
    {
      phase: "公式定义",
      title: "用 Γ₂D 表示剩余驱动与开关代价的相对关系",
      route: { item: "p322" },
      role: "Γ₂D 越高，说明接触损耗后仍保留较多驱动余量，同时完成开关所需的栅压代价较小。它只辅助判读，不替代原始转移曲线、输出曲线和统计分布。",
      nodes: [
        { label: "分子：有效漏源电压余量", route: { item: "p322" } },
        { label: "分母：栅控开关代价", route: { item: "p322" } },
        { label: "Π₂D 只作固定单位观察量", route: { item: "p325" } },
        { label: "不能当单一总评分", route: { section: "s11" } }
      ]
    },
    {
      phase: "数据试算",
      title: "严格计算、估算排序和缺参样本必须分开",
      route: { item: "p323" },
      role: "近三年候选记录中，只有同时给出开态电流、接触电阻、接触电阻口径、漏源电压、SS 和开关窗口的样本才能严格计算。字段不足时，只能保留缺失项和复核优先级。",
      nodes: [
        { label: "9 条严格可计算样本", route: { item: "p323" } },
        { label: "6 条估算排序样本", route: { item: "p325" } },
        { label: "20 条待补参数样本", route: { item: "p327" } },
        { label: "缺失字段本身就是结论", route: { item: "p327" } }
      ]
    },
    {
      phase: "边界条件",
      title: "先收紧口径，再谈普适性",
      route: { item: "p327" },
      role: "Γ₂D 目前适合逻辑导向二维 FET 的器件层辅助比较，不宜直接用于传感、光电、功率、柔性或系统集成为主的论文。样本增多后也要继续保留口径差异说明。",
      nodes: [
        { label: "接触电阻口径可能差一倍", route: { item: "p327" } },
        { label: "SS 最小值和平均值不同", route: { item: "p327" } },
        { label: "偏压和尺寸不能混作同口径", route: { section: "s11" } },
        { label: "不能替代可靠性与电路验证", route: { section: "s28" } }
      ]
    },
    {
      phase: "应用方式",
      title: "把公式转化为文献报告规范和审稿检查表",
      route: { section: "s11" },
      role: "真正有用的不是制造排行榜，而是提醒作者和读者：若一篇二维晶体管论文声称适合先进逻辑，就应同时报告偏压、几何、接触、栅控、开关窗口和统计信息。",
      nodes: [
        { label: "计算结果只作辅助排序", route: { item: "p325" } },
        { label: "缺参样本不强行补数", route: { item: "p327" } },
        { label: "最低报告清单", route: { section: "s11" } },
        { label: "回到综述主线", route: { section: "s30" } }
      ]
    }
  ]
};

const appendixStats = [
  { label: "严格计算", value: "9", note: "六类核心字段完整，可计算 Γ₂D。" },
  { label: "估算排序", value: "6", note: "至少一个字段或口径不足，只能作为线索。" },
  { label: "待补参数", value: "20", note: "缺少核心字段，不给正式 Γ₂D 排名。" }
];

const appendixTopSamples = [
  ["Lan 等 / NO-WSe₂", "2025", "WSe₂ pFET", "1.31", "严格计算"],
  ["Jiang 等 / Y-MoS₂", "2025", "MoS₂ nFET", "1.208", "严格计算"],
  ["Lan 等 / 单层 WSe₂", "2025", "WSe₂ pFET", "1.171", "严格计算"],
  ["Ghosh 等 / NO-WSe₂", "2025", "WSe₂ pFET", "0.862", "严格计算"],
  ["Li 等 / vdW MoS₂", "2023", "MoS₂ nFET", "0.659", "严格计算"]
];

const appendixBoundaries = [
  "接触电阻必须标明单侧还是源漏总等效；未说明时不应给出正式排名。",
  "SS 应说明最小值、代表值、平均值或统计分布；不同取法会改变 Γ₂D。",
  "开态电流、漏源电压、沟道长度、接触长度和栅介质条件必须来自同一器件或同一统计口径。",
  "Γ₂D 只适用于逻辑导向二维 FET 的器件层辅助比较，不直接用于传感、光电、功率或柔性器件。",
  "该因子不能替代可靠性、迟滞、阈值漂移、热管理、良率和电路功能验证。"
];

const appendixChecklist = [
  ["测试条件", "漏源电压、栅压范围、温度、扫描方向"],
  ["驱动能力", "开态电流数值、归一化方式、对应偏压"],
  ["关断与栅控", "关态电流或开关比、SS 取值方式与统计分布"],
  ["接触", "接触电阻数值、单侧/总等效口径、接触长度、提取方法"],
  ["几何与栅介质", "沟道长度、接触长度、EOT、介质材料、栅结构"],
  ["统计", "样本数、良率、阈值、开态电流、SS 和迟滞分布"]
];

const appendixState = {
  editMode: false,
  map: loadAppendixMap()
};

const $ = (selector) => document.querySelector(selector);

bindAppendixEvents();
renderAppendixAll();

function bindAppendixEvents() {
  $("#toggle-appendix-edit")?.addEventListener("click", () => {
    appendixState.editMode = !appendixState.editMode;
    renderAppendixAll();
  });

  $("#export-appendix-edits")?.addEventListener("click", exportAppendixEdits);
  $("#import-appendix-edits")?.addEventListener("click", () => $("#import-appendix-edits-file")?.click());
  $("#import-appendix-edits-file")?.addEventListener("change", (event) => {
    importAppendixEditsFromFile(event.target.files?.[0]);
    event.target.value = "";
  });

  $("#reset-appendix-map")?.addEventListener("click", () => {
    if (!window.confirm("确定恢复公式附录导图默认内容吗？当前浏览器中保存的修改会被清除。")) return;
    appendixState.map = deepClone(appendixDefaultMap);
    localStorage.removeItem(APPENDIX_EDIT_KEY);
    renderAppendixAll();
  });

  document.addEventListener("input", (event) => {
    const editable = event.target.closest("[data-appendix-path]");
    if (!editable) return;
    setAppendixPath(editable.dataset.appendixPath, editable.textContent.trim());
    saveAppendixMap();
    updateAppendixStatus();
  });
}

function renderAppendixAll() {
  renderAppendixMap();
  renderAppendixDataPanel();
  renderAppendixBoundaryPanel();
  updateAppendixStatus();
}

function renderAppendixMap() {
  const stages = appendixState.map.stages || [];
  $("#appendix-map").innerHTML = `
    <section class="appendix-thesis">
      <div>
        <span>中心判断</span>
        ${renderEditableText("p", appendixState.map.thesis, "thesis", "appendix-thesis-text")}
      </div>
      <a class="appendix-thesis-link" href="./index.html?section=s11">正文评价口径</a>
    </section>
    <div class="appendix-stage-stack">
      ${stages.map((stage, index) => `${renderAppendixStage(stage, index)}${index < stages.length - 1 ? '<div class="appendix-down-arrow" aria-hidden="true"></div>' : ""}`).join("")}
    </div>
  `;
}

function renderAppendixStage(stage, index) {
  const titlePath = `stages.${index}.title`;
  const rolePath = `stages.${index}.role`;
  const nodes = (stage.nodes || [])
    .map((node, nodeIndex) => renderAppendixNode(node, `stages.${index}.nodes.${nodeIndex}.label`))
    .join("");
  return `
    <article class="appendix-stage">
      <div class="appendix-stage-head">
        <span class="appendix-phase">${escapeHtml(stage.phase)}</span>
        ${renderRoutedText("strong", stage.title, titlePath, stage.route, "appendix-stage-title")}
      </div>
      ${renderEditableText("p", stage.role, rolePath, "appendix-stage-role")}
      <div class="appendix-node-grid">${nodes}</div>
    </article>
  `;
}

function renderAppendixNode(node, path) {
  return renderRoutedText("span", node.label, path, node.route, "appendix-node");
}

function renderRoutedText(tag, text, path, route, className) {
  if (appendixState.editMode) {
    return `<${tag} class="${escapeAttr(className)} editable-node" contenteditable="true" spellcheck="false" data-appendix-path="${escapeAttr(path)}">${escapeHtml(text)}</${tag}>`;
  }
  return `<a class="${escapeAttr(className)}" href="${escapeAttr(routeHref(route))}">${escapeHtml(text)}</a>`;
}

function renderEditableText(tag, text, path, className) {
  if (appendixState.editMode) {
    return `<${tag} class="${escapeAttr(className)} editable-node" contenteditable="true" spellcheck="false" data-appendix-path="${escapeAttr(path)}">${escapeHtml(text)}</${tag}>`;
  }
  return `<${tag} class="${escapeAttr(className)}">${escapeHtml(text)}</${tag}>`;
}

function renderAppendixDataPanel() {
  const stats = appendixStats
    .map(
      (stat) => `
        <article class="appendix-stat">
          <b>${escapeHtml(stat.value)}</b>
          <strong>${escapeHtml(stat.label)}</strong>
          <p>${escapeHtml(stat.note)}</p>
        </article>
      `
    )
    .join("");
  const rows = appendixTopSamples
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row[0])}</td>
          <td>${escapeHtml(row[1])}</td>
          <td>${escapeHtml(row[2])}</td>
          <td>${escapeHtml(row[3])}</td>
          <td>${escapeHtml(row[4])}</td>
        </tr>
      `
    )
    .join("");
  $("#appendix-data-panel").innerHTML = `
    <div class="appendix-stat-grid">${stats}</div>
    <div class="appendix-data-note">
      <strong>读法</strong>
      <p>排序只展示严格计算样本中的代表项。估算样本和待补参数样本不应混入正式排名，它们的作用是提示哪些文献还需要回到原文图表、补充信息或作者数据中继续核对。</p>
    </div>
    <div class="appendix-table-wrap">
      <table class="appendix-table">
        <thead>
          <tr>
            <th>样本</th>
            <th>年份</th>
            <th>器件</th>
            <th>Γ₂D</th>
            <th>口径</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderAppendixBoundaryPanel() {
  const boundaryItems = appendixBoundaries.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const checklistRows = appendixChecklist
    .map(
      ([category, content]) => `
        <tr>
          <td>${escapeHtml(category)}</td>
          <td>${escapeHtml(content)}</td>
        </tr>
      `
    )
    .join("");
  $("#appendix-boundary-panel").innerHTML = `
    <div class="appendix-boundary-grid">
      <section>
        <h3>适用边界</h3>
        <ul>${boundaryItems}</ul>
      </section>
      <section>
        <h3>最低报告清单</h3>
        <div class="appendix-table-wrap">
          <table class="appendix-table compact-table">
            <tbody>${checklistRows}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function routeHref(route = {}) {
  const params = new URLSearchParams();
  if (route.section) params.set("section", route.section);
  if (route.item) params.set("item", route.item);
  if (route.theme) params.set("theme", route.theme);
  if (route.q) params.set("q", route.q);
  return `./index.html${params.toString() ? `?${params.toString()}` : ""}`;
}

function loadAppendixMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(APPENDIX_EDIT_KEY) || "{}");
    return parsed.map?.stages ? parsed.map : deepClone(appendixDefaultMap);
  } catch {
    return deepClone(appendixDefaultMap);
  }
}

function saveAppendixMap() {
  localStorage.setItem(
    APPENDIX_EDIT_KEY,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      map: appendixState.map
    })
  );
}

function setAppendixPath(path, value) {
  const parts = String(path).split(".");
  let target = appendixState.map;
  for (let index = 0; index < parts.length - 1; index += 1) {
    target = target[parts[index]];
    if (target == null) return;
  }
  target[parts[parts.length - 1]] = value;
}

function updateAppendixStatus() {
  const saved = localStorage.getItem(APPENDIX_EDIT_KEY) ? "已保存修改" : "默认内容";
  const mode = appendixState.editMode ? "编辑模式：点击文字直接修改" : "只读模式：点击节点跳转正文或数据位置";
  const status = $("#appendix-edit-status");
  if (status) status.textContent = `${mode} · ${saved}`;
  const toggle = $("#toggle-appendix-edit");
  if (toggle) toggle.textContent = appendixState.editMode ? "退出编辑" : "编辑导图";
}

function exportAppendixEdits() {
  downloadJson(
    {
      type: "appendix-map-edits",
      exportedAt: new Date().toISOString(),
      map: appendixState.map
    },
    `appendix-map-edits-${Date.now()}.json`
  );
}

function importAppendixEditsFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const map = parsed.map || parsed.edits?.map;
      if (!map?.stages) throw new Error("JSON 中没有公式附录导图 map 数据。");
      appendixState.map = map;
      saveAppendixMap();
      renderAppendixAll();
      window.alert("公式附录导图已导入。");
    } catch (error) {
      window.alert(`导入失败：${error.message}`);
    }
  });
  reader.readAsText(file, "utf-8");
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
