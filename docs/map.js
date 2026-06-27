const data = window.PAPER_DATA || null;
const FRAMEWORK_EDIT_KEY = "paperViz.frameworkEdits.v1";

const $ = (selector) => document.querySelector(selector);

const frameworkStages = [
  {
    phase: "提出问题",
    chapter: "第一章",
    sectionId: "s1",
    core: "后摩尔时代为什么需要重新评价二维半导体",
    nodes: ["硅缩放压力", "二维材料兴起", "论文对象与主线"],
    note: "从技术背景进入问题意识：二维半导体的价值不只在材料很薄，而在能否保留为器件和系统优势。"
  },
  {
    phase: "建立基础",
    chapter: "第二章",
    sectionId: "s6",
    core: "材料基础、器件指标与评价口径",
    nodes: ["材料谱系", "器件结构", "关键指标"],
    verticalGroups: [
      { title: "材料", items: ["带隙", "厚度", "迁移率", "稳定性"] },
      { title: "器件", items: ["开态电流", "关态漏电", "接触电阻", "亚阈值摆幅"] },
      { title: "口径", items: ["偏压", "尺寸", "统计", "良率"] }
    ],
    note: "先说明评价对象，再说明哪些数字可以比较、哪些数字必须回到测试条件。"
  },
  {
    phase: "分析问题",
    chapter: "第三章",
    sectionId: "s12",
    core: "基础问题与关键进展",
    nodes: ["短沟道与栅控", "接触与介质", "极性与加工"],
    verticalGroups: [
      { title: "沟道", items: ["短沟道", "纳米带", "栅控", "势垒降低"] },
      { title: "界面", items: ["费米钉扎", "界面偶极", "缺陷态", "高k介质"] },
      { title: "工艺", items: ["p型调控", "低损伤刻蚀", "晶圆转移", "图形化"] }
    ],
    note: "把单项进展放回物理机制中，解释为什么接触、介质、极性和加工不能分开判断。"
  },
  {
    phase: "判断路径",
    chapter: "第四章",
    sectionId: "s19",
    core: "应用场景与发展方向",
    nodes: ["先进逻辑", "单片三维", "柔性与感知融合"],
    note: "比较不同路线的系统价值：二维半导体未必首先替代硅前道，也可能先进入后道集成和功能融合。"
  },
  {
    phase: "收束挑战",
    chapter: "第五章",
    sectionId: "s24",
    core: "工程化挑战与最低报告信息",
    nodes: ["n/p配对", "晶圆一致性", "可靠性与热管理", "CMOS兼容"],
    verticalGroups: [
      { title: "器件", items: ["阈值匹配", "迟滞", "漏电", "可靠性"] },
      { title: "制造", items: ["样本数", "良率", "离散度", "复现性"] },
      { title: "集成", items: ["热预算", "互连", "模型", "版图"] }
    ],
    note: "把挑战转化为可报告、可复核的数据清单，避免只比较最好器件。"
  },
  {
    phase: "解决问题",
    chapter: "第六章",
    sectionId: "s30",
    core: "从单器件纪录走向技术平台判断",
    nodes: ["统一评价口径", "阶段推进路线", "后摩尔平台意义"],
    note: "最终判断：二维半导体研究正在从现象丰富的前沿方向，转向需要统一工程语言的技术平台。"
  }
];

const frameworkState = {
  editMode: false,
  stages: loadFrameworkStages()
};

const frameworkRoutes = {
  硅缩放压力: { section: "s3" },
  二维材料兴起: { section: "s4" },
  论文对象与主线: { section: "s5" },
  材料谱系: { section: "s7" },
  器件结构: { section: "s8" },
  关键指标: { section: "s10" },
  带隙: { section: "s7" },
  厚度: { section: "s7" },
  迁移率: { section: "s7" },
  稳定性: { theme: "dielectric" },
  开态电流: { theme: "evaluation" },
  关态漏电: { theme: "scaling" },
  接触电阻: { theme: "contact" },
  亚阈值摆幅: { theme: "scaling" },
  偏压: { theme: "evaluation" },
  尺寸: { theme: "scaling" },
  统计: { theme: "evaluation" },
  良率: { theme: "wafer" },
  短沟道与栅控: { section: "s13" },
  接触与介质: { section: "s26" },
  极性与加工: { section: "s16" },
  短沟道: { section: "s13" },
  纳米带: { section: "s13" },
  栅控: { theme: "scaling" },
  势垒降低: { theme: "scaling" },
  费米钉扎: { theme: "contact" },
  界面偶极: { theme: "dielectric" },
  缺陷态: { theme: "dielectric" },
  高k介质: { section: "s15" },
  p型调控: { section: "s16" },
  低损伤刻蚀: { section: "s17" },
  晶圆转移: { section: "s18" },
  图形化: { section: "s17" },
  先进逻辑: { section: "s20" },
  单片三维: { section: "s21" },
  柔性与感知融合: { section: "s22" },
  "n/p配对": { section: "s25" },
  晶圆一致性: { section: "s27" },
  可靠性与热管理: { section: "s28" },
  CMOS兼容: { section: "s29" },
  阈值匹配: { section: "s25" },
  迟滞: { section: "s28" },
  漏电: { theme: "dielectric" },
  可靠性: { section: "s28" },
  样本数: { theme: "evaluation" },
  离散度: { theme: "wafer" },
  复现性: { theme: "evaluation" },
  热预算: { section: "s29" },
  互连: { section: "s29" },
  模型: { section: "s29" },
  版图: { section: "s20" },
  统一评价口径: { section: "s11" },
  阶段推进路线: { section: "s32" },
  后摩尔平台意义: { section: "s33" }
};

if (!data) {
  document.body.innerHTML = "<main class='empty-state'>缺少 data/paper-data.js，请先运行 python3 scripts/build_paper_data.py。</main>";
} else {
  bindMapEvents();
  renderFrameworkDiagram();
  renderMindMap();
  renderLogicOutline();
  renderEvidenceMatrix();
  renderCitationNetwork();
}

function bindMapEvents() {
  $("#toggle-framework-edit")?.addEventListener("click", () => {
    frameworkState.editMode = !frameworkState.editMode;
    renderFrameworkDiagram();
    updateFrameworkStatus();
  });

  $("#export-framework-edits")?.addEventListener("click", exportFrameworkEdits);

  $("#import-framework-edits")?.addEventListener("click", () => $("#import-framework-edits-file")?.click());

  $("#import-framework-edits-file")?.addEventListener("change", (event) => {
    importFrameworkEditsFromFile(event.target.files?.[0]);
    event.target.value = "";
  });

  $("#reset-framework")?.addEventListener("click", () => {
    if (!window.confirm("确定恢复默认框架图内容吗？当前浏览器中保存的框架图修改会被清除。")) return;
    frameworkState.stages = deepClone(frameworkStages);
    localStorage.removeItem(FRAMEWORK_EDIT_KEY);
    renderFrameworkDiagram();
    updateFrameworkStatus();
  });

  document.addEventListener("input", (event) => {
    const editable = event.target.closest("[data-fw-path]");
    if (!editable) return;
    setFrameworkPath(editable.dataset.fwPath, editable.textContent.trim());
    saveFrameworkStages();
    updateFrameworkStatus();
  });
}

function renderFrameworkDiagram() {
  const stages = frameworkState.stages;
  $("#framework-diagram").innerHTML = `
    <div class="framework-stack">
      ${stages.map((stage, index) => `${renderFrameworkStage(stage, index)}${index < stages.length - 1 ? renderFrameworkArrow() : ""}`).join("")}
    </div>
    <p class="framework-caption">
      图示说明：本框架图按论文论证顺序组织，不是简单章节目录。左侧表示问题处理阶段，右侧对应正文章节；中间节点显示每章承担的论证功能。
    </p>
  `;
  updateFrameworkStatus();
}

function renderFrameworkStage(stage, stageIndex) {
  const nodeRow = stage.nodes
    .map((node, nodeIndex) => renderFrameworkText("framework-node", node, `${stageIndex}.nodes.${nodeIndex}`, stage.sectionId))
    .join("");
  const verticalGroups = (stage.verticalGroups || [])
    .map(
      (group, groupIndex) => `
        <div class="framework-vertical-group">
          ${renderFrameworkText("framework-group-title", group.title, `${stageIndex}.verticalGroups.${groupIndex}.title`, stage.sectionId)}
          <div>
            ${group.items.map((item, itemIndex) => renderFrameworkText("framework-vertical-item", item, `${stageIndex}.verticalGroups.${groupIndex}.items.${itemIndex}`, stage.sectionId)).join("")}
          </div>
        </div>
      `
    )
    .join("");
  return `
    <section class="framework-stage">
      ${renderFrameworkText("framework-phase", stage.phase, `${stageIndex}.phase`, stage.sectionId)}
      ${renderFrameworkText("framework-chapter", stage.chapter, `${stageIndex}.chapter`, stage.sectionId)}
      <div class="framework-body">
        ${renderFrameworkText("framework-core", stage.core, `${stageIndex}.core`, stage.sectionId)}
        <div class="framework-connector"></div>
        <div class="framework-node-row">${nodeRow}</div>
        ${verticalGroups ? `<div class="framework-vertical-row">${verticalGroups}</div>` : ""}
        ${renderFrameworkText("framework-note", stage.note, `${stageIndex}.note`)}
      </div>
    </section>
  `;
}

function renderFrameworkText(className, text, path, sectionId = "") {
  if (frameworkState.editMode) {
    const tag = className === "framework-vertical-item" ? "em" : className === "framework-note" ? "p" : "span";
    return `<${tag} class="${escapeAttr(className)} editable-node" contenteditable="true" spellcheck="false" data-fw-path="${escapeAttr(path)}">${escapeHtml(text)}</${tag}>`;
  }
  if (className === "framework-vertical-item") return `<a class="${escapeAttr(className)}" href="${escapeAttr(frameworkHref(text, sectionId))}">${escapeHtml(text)}</a>`;
  if (className === "framework-note") return `<p class="${escapeAttr(className)}">${escapeHtml(text)}</p>`;
  const href = frameworkHref(text, sectionId);
  return `<a class="${escapeAttr(className)}" href="${escapeAttr(href)}">${escapeHtml(text)}</a>`;
}

function frameworkHref(label, fallbackSection = "") {
  const route = frameworkRoutes[label];
  const params = new URLSearchParams();
  if (route?.section || fallbackSection) params.set("section", route?.section || fallbackSection);
  if (route?.theme) params.set("theme", route.theme);
  if (route?.type) params.set("type", route.type);
  if (route?.ref) params.set("ref", route.ref);
  return `./index.html${params.toString() ? `?${params.toString()}` : ""}`;
}

function renderFrameworkArrow() {
  return `<div class="framework-arrow" aria-hidden="true"></div>`;
}

function renderMindMap() {
  const map = data.argumentMap || { center: "", nodes: [] };
  $("#mind-map").innerHTML = `
    <article class="center-thesis">
      <strong>中心论点</strong>
      <p>${escapeHtml(map.center || "论文主线")}</p>
    </article>
    <div class="mind-branches">
      ${(map.nodes || []).map(renderMindNode).join("")}
    </div>
  `;
}

function renderMindNode(node) {
  const children = (node.children || [])
    .map((child) => `<a href="./index.html?section=${escapeAttr(child.id)}">${escapeHtml(child.label)}</a>`)
    .join("");
  return `
    <article class="mind-node">
      <a class="mind-main-link" href="./index.html?section=${escapeAttr(node.id)}">${escapeHtml(node.label)}</a>
      <div class="child-chips">${children}</div>
    </article>
  `;
}

function renderLogicOutline() {
  const sections = data.sections.filter((section) => section.level > 0);
  $("#logic-outline").innerHTML = sections
    .map((section) => {
      const indent = Math.max(0, section.level - 1) * 18;
      return `
        <a class="toc-item level-${section.level}" href="./index.html?section=${escapeAttr(section.id)}" style="padding-left:${indent + 8}px">
          ${escapeHtml(section.fullTitle || section.title)}
          <span class="count">${section.citationCount || 0} 引用</span>
        </a>
      `;
    })
    .join("");
}

function renderEvidenceMatrix() {
  const themes = data.evidenceThemes || [];
  const maxParagraphs = Math.max(1, ...themes.map((theme) => theme.paragraphCount || 0));
  $("#evidence-matrix").innerHTML = themes
    .map((theme) => {
      const width = Math.max(5, Math.round(((theme.paragraphCount || 0) / maxParagraphs) * 100));
      const refs = (theme.topReferences || [])
        .slice(0, 5)
        .map((number) => `<a class="citation-chip" href="./index.html?ref=${number}">[${number}]</a>`)
        .join("");
      return `
        <article class="evidence-card">
          <a class="evidence-main" href="./index.html?theme=${escapeAttr(theme.id)}">
            <span class="evidence-name">${escapeHtml(theme.name)}</span>
            <span class="evidence-desc">${escapeHtml(theme.description)}</span>
            <span class="evidence-stats">
              <b>${theme.paragraphCount || 0}</b> 段 · <b>${theme.referenceCount || 0}</b> 篇文献
            </span>
            <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
          </a>
          ${refs ? `<div class="evidence-refs">${refs}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderCitationNetwork() {
  const references = [...data.references]
    .filter((ref) => ref.usageCount > 0)
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 12);
  const maxUsage = Math.max(1, ...references.map((ref) => ref.usageCount));
  const topRefRows = references
    .map((ref) => {
      const width = Math.max(6, Math.round((ref.usageCount / maxUsage) * 100));
      return `
        <a class="network-ref" href="./index.html?ref=${ref.number}">
          <span class="network-ref-head"><b>[${ref.number}]</b><em>${ref.usageCount} 次</em></span>
          <span class="network-ref-title">${escapeHtml(compactRef(ref.text))}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
        </a>
      `;
    })
    .join("");
  const themeRows = (data.evidenceThemes || [])
    .filter((theme) => theme.referenceCount > 0)
    .slice(0, 8)
    .map((theme) => {
      const refs = (theme.topReferences || [])
        .slice(0, 4)
        .map((number) => `<a class="citation-chip" href="./index.html?ref=${number}">[${number}]</a>`)
        .join("");
      return `
        <div class="network-theme-row">
          <a href="./index.html?theme=${escapeAttr(theme.id)}">${escapeHtml(theme.name)}</a>
          <span>${refs}</span>
        </div>
      `;
    })
    .join("");
  $("#citation-network").innerHTML = `
    <div class="network-grid">
      <div>
        <h3>高频核心文献</h3>
        <div class="network-ref-list">${topRefRows}</div>
      </div>
      <div>
        <h3>主题-文献连接</h3>
        <div class="network-theme-list">${themeRows}</div>
      </div>
    </div>
  `;
}

function loadFrameworkStages() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FRAMEWORK_EDIT_KEY) || "{}");
    return Array.isArray(parsed.stages) ? parsed.stages : deepClone(frameworkStages);
  } catch {
    return deepClone(frameworkStages);
  }
}

function saveFrameworkStages() {
  localStorage.setItem(
    FRAMEWORK_EDIT_KEY,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      stages: frameworkState.stages
    })
  );
}

function setFrameworkPath(path, value) {
  const parts = String(path).split(".");
  let target = frameworkState.stages;
  for (let index = 0; index < parts.length - 1; index += 1) {
    target = target[parts[index]];
    if (target == null) return;
  }
  target[parts[parts.length - 1]] = value;
}

function updateFrameworkStatus() {
  const saved = localStorage.getItem(FRAMEWORK_EDIT_KEY) ? "已保存修改" : "默认内容";
  const mode = frameworkState.editMode ? "编辑模式：点击文字直接改" : "只读模式：点击节点跳转正文";
  const status = $("#framework-edit-status");
  if (status) status.textContent = `${mode} · ${saved}`;
  const toggle = $("#toggle-framework-edit");
  if (toggle) toggle.textContent = frameworkState.editMode ? "退出编辑" : "编辑框架图";
}

function exportFrameworkEdits() {
  downloadJson(
    {
      type: "framework-edits",
      exportedAt: new Date().toISOString(),
      stages: frameworkState.stages
    },
    `framework-edits-${Date.now()}.json`
  );
}

function importFrameworkEditsFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const stages = parsed.stages || parsed.edits?.stages;
      if (!Array.isArray(stages)) {
        throw new Error("JSON 中没有 stages 框架图数据。");
      }
      frameworkState.stages = stages;
      saveFrameworkStages();
      renderFrameworkDiagram();
      updateFrameworkStatus();
      window.alert("框架图修改已导入。");
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

function compactRef(text) {
  const cleaned = String(text || "").replace(/\s*DOI:\s*10\..*$/i, "").trim();
  return cleaned.length > 96 ? cleaned.slice(0, 96) + "..." : cleaned;
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
