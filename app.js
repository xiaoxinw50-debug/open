const data = window.PAPER_DATA || null;
const PAPER_EDIT_KEY = "paperViz.paperEdits.v1";

const state = {
  sectionId: "all",
  activeItemId: null,
  query: "",
  type: "all",
  refQuery: "",
  focusRef: null,
  themeId: "all",
  expanded: true,
  editMode: false,
  edits: loadPaperEdits()
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

if (!data) {
  document.body.innerHTML = "<main class='empty-state'>缺少 data/paper-data.js，请先运行 python3 scripts/build_paper_data.py。</main>";
} else {
  init();
}

function init() {
  applyInitialRoute();
  bindEvents();
  renderAll();
  syncControlsFromState();
  scrollToInitialTarget();
}

function applyInitialRoute() {
  const params = new URLSearchParams(window.location.search);
  const section = params.get("section");
  const type = params.get("type");
  const theme = params.get("theme");
  const query = params.get("q");
  const ref = Number(params.get("ref"));
  const item = params.get("item");

  if (section && data.sections.some((entry) => entry.id === section)) state.sectionId = section;
  if (type && type !== "all") state.type = type;
  if (theme && theme !== "all") state.themeId = theme;
  if (query) state.query = query.trim();
  if (Number.isFinite(ref) && ref > 0) state.focusRef = ref;
  if (item && data.items.some((entry) => entry.id === item)) state.activeItemId = item;
}

function syncControlsFromState() {
  if ($("#search-input")) $("#search-input").value = state.query;
  if ($("#type-filter")) $("#type-filter").value = state.type;
  if ($("#reference-search")) $("#reference-search").value = state.refQuery;
  updateEditStatus();
}

function scrollToInitialTarget() {
  if (!window.location.search) return;
  requestAnimationFrame(() => {
    if (state.activeItemId) {
      document.querySelector(`[data-item-id="${CSS.escape(state.activeItemId)}"]`)?.scrollIntoView({ block: "center" });
      return;
    }
    scrollToReadingPanel();
  });
}

function bindEvents() {
  $("#search-input").addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    state.activeItemId = null;
    renderParagraphs();
  });

  $("#type-filter").addEventListener("change", (event) => {
    state.type = event.target.value;
    state.activeItemId = null;
    renderParagraphs();
  });

  $("#reference-search").addEventListener("input", (event) => {
    state.refQuery = event.target.value.trim();
    renderBibliography();
  });

  $("#toggle-edit")?.addEventListener("click", () => {
    state.editMode = !state.editMode;
    renderParagraphs();
    renderReferenceDetail();
    updateEditStatus();
  });

  $("#export-edits")?.addEventListener("click", exportPaperEdits);

  $("#import-edits")?.addEventListener("click", () => $("#import-edits-file")?.click());

  $("#import-edits-file")?.addEventListener("change", (event) => {
    importPaperEditsFromFile(event.target.files?.[0]);
    event.target.value = "";
  });

  $("#clear-edits")?.addEventListener("click", () => {
    if (!window.confirm("确定清除当前浏览器中保存的论文修改，恢复为 DOCX 原文吗？")) return;
    state.edits = { items: {}, updatedAt: new Date().toISOString() };
    savePaperEdits();
    renderAll();
    updateEditStatus();
  });

  $("#reset-view").addEventListener("click", () => {
    state.sectionId = "all";
    state.activeItemId = null;
    state.query = "";
    state.type = "all";
    state.refQuery = "";
    state.focusRef = null;
    state.themeId = "all";
    state.expanded = true;
    $("#search-input").value = "";
    $("#type-filter").value = "all";
    $("#reference-search").value = "";
    $("#toggle-length").textContent = "折叠长文";
    renderAll();
  });

  $("#toggle-length").addEventListener("click", () => {
    state.expanded = !state.expanded;
    $("#toggle-length").textContent = state.expanded ? "折叠长文" : "显示全文";
    renderParagraphs();
  });

  document.addEventListener("click", (event) => {
    if (state.editMode && event.target.closest("[data-edit-id], [data-table-edit-id]")) {
      return;
    }

    const sectionButton = event.target.closest("[data-section-id]");
    if (sectionButton) {
      state.sectionId = sectionButton.dataset.sectionId;
      state.focusRef = null;
      state.themeId = "all";
      state.activeItemId = null;
      renderAll();
      scrollToReadingPanel();
      return;
    }

    const refButton = event.target.closest("[data-ref-number]");
    if (refButton) {
      event.stopPropagation();
      state.focusRef = Number(refButton.dataset.refNumber);
      state.sectionId = "all";
      state.themeId = "all";
      state.activeItemId = null;
      renderAll();
      scrollToReadingPanel();
      return;
    }

    const themeButton = event.target.closest("[data-theme-id]");
    if (themeButton) {
      state.themeId = themeButton.dataset.themeId;
      state.sectionId = "all";
      state.focusRef = null;
      state.activeItemId = null;
      renderAll();
      scrollToReadingPanel();
      return;
    }

    const itemCard = event.target.closest("[data-item-id]");
    if (itemCard) {
      state.activeItemId = itemCard.dataset.itemId;
      renderParagraphs();
      renderReferenceDetail();
      if (window.matchMedia("(max-width: 1180px)").matches) {
        $(".reference-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  });

  document.addEventListener("input", (event) => {
    const paragraphEditor = event.target.closest("[data-edit-id]");
    if (paragraphEditor) {
      updatePaperTextEdit(paragraphEditor.dataset.editId, paragraphEditor.value);
      return;
    }

    const tableCell = event.target.closest("[data-table-edit-id]");
    if (tableCell) {
      updatePaperTableEdit(
        tableCell.dataset.tableEditId,
        Number(tableCell.dataset.rowIndex),
        Number(tableCell.dataset.cellIndex),
        tableCell.textContent
      );
    }
  });
}

function renderAll() {
  renderMeta();
  renderToc();
  renderParagraphs();
  renderReferenceDetail();
  renderBibliography();
}

function renderMeta() {
  setText("#paper-title", data.meta.title);
  setText("#metric-paragraphs", data.meta.paragraphCount);
  setText("#metric-references", data.meta.referenceCount);
  setText("#metric-cited", data.meta.citedReferenceCount);
  setText("#source-file", `来源文件：${data.meta.sourceFile}`);
  updateEditStatus();
}

function renderToc() {
  const toc = $("#toc-list");
  const sections = data.sections.filter((section) => section.level <= 2);
  toc.innerHTML = [
    tocButton({ id: "all", fullTitle: "全文", level: 1, citationCount: totalCitationCount() }),
    ...sections.map(tocButton)
  ].join("");
}

function tocButton(section) {
  const active = state.sectionId === section.id ? " is-active" : "";
  const level = section.level === 2 ? " level-2" : "";
  const count = section.citationCount ? `<span class="count">${section.citationCount}</span>` : "";
  return `
    <button class="toc-item${level}${active}" type="button" data-section-id="${escapeAttr(section.id)}">
      ${escapeHtml(section.fullTitle || section.title)}${count}
    </button>
  `;
}

function renderCitationBars() {
  const container = $("#citation-bars");
  const sections = data.sections
    .filter((section) => section.level === 1 || section.level === 2)
    .filter((section) => section.citationCount > 0)
    .slice(0, 12);
  const max = Math.max(1, ...sections.map((section) => section.citationCount));
  container.innerHTML = sections
    .map((section) => {
      const width = Math.max(4, Math.round((section.citationCount / max) * 100));
      return `
        <button class="bar-row" type="button" data-section-id="${escapeAttr(section.id)}">
          <span class="bar-label">
            <span>${escapeHtml(section.fullTitle || section.title)}</span>
            <b>${section.citationCount}</b>
          </span>
          <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
        </button>
      `;
    })
    .join("") || "<div class='empty-state'>暂无引用统计。</div>";
}

function renderMindMap() {
  const map = data.argumentMap || { center: "", nodes: [] };
  const nodes = map.nodes || [];
  $("#mind-map").innerHTML = `
    <article class="center-thesis">
      <strong>central argument</strong>
      <p>${escapeHtml(map.center || "论文主线")}</p>
    </article>
    <div class="mind-branches">
      ${nodes.map(renderMindNode).join("")}
    </div>
  `;
}

function renderMindNode(node) {
  const active = state.sectionId === node.id ? " is-active" : "";
  const children = (node.children || [])
    .map(
      (child) => `
        <button type="button" data-section-id="${escapeAttr(child.id)}">
          ${escapeHtml(compactHeading(child.label))}
        </button>
      `
    )
    .join("");
  return `
    <article class="mind-node${active}">
      <button type="button" data-section-id="${escapeAttr(node.id)}">
        ${escapeHtml(node.label)}
      </button>
      <div class="child-chips">${children}</div>
    </article>
  `;
}

function renderParagraphs() {
  const list = $("#paragraph-list");
  const filtered = filteredItems();
  const displayLimit = state.expanded || state.query || state.sectionId !== "all" || state.focusRef ? filtered.length : 95;
  const visible = filtered.slice(0, displayLimit);
  $("#paragraph-count-label").textContent = `${filtered.length} 个匹配段落；点击段落查看参考文献`;
  list.innerHTML = visible.map(renderParagraphCard).join("");
  if (visible.length < filtered.length) {
    list.insertAdjacentHTML(
      "beforeend",
      `<button class="ghost-button" type="button" id="load-more-inline">还有 ${filtered.length - visible.length} 段，点击展开</button>`
    );
    $("#load-more-inline").addEventListener("click", () => {
      state.expanded = true;
      $("#toggle-length").textContent = "折叠长文";
      renderParagraphs();
    });
  }
  if (!filtered.length) {
    list.innerHTML = "<div class='empty-state'>没有找到匹配段落。换一个关键词或清空筛选条件。</div>";
  }
}

function filteredItems() {
  const query = state.query.toLowerCase();
  return data.items.filter((item) => {
    if (state.sectionId !== "all" && item.sectionId !== state.sectionId && !isDescendantSection(item.sectionId, state.sectionId)) {
      return false;
    }
    if (state.type !== "all" && item.type !== state.type) {
      return false;
    }
    if (state.themeId !== "all" && !(item.topics || []).includes(state.themeId)) {
      return false;
    }
    if (state.focusRef && !item.citations.includes(state.focusRef)) {
      return false;
    }
    if (query && !getItemText(item).toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });
}

function renderParagraphCard(item) {
  const active = state.activeItemId === item.id ? " is-active" : "";
  if (item.kind === "image") {
    return renderImageBlock(item, active);
  }
  if (item.kind === "table") {
    return renderTableBlock(item, active);
  }
  const captionKind = item.captionKind ? ` data-caption-kind="${escapeAttr(item.captionKind)}"` : "";
  const text = getItemText(item);
  if (state.editMode) {
    return `
      <article id="item-${escapeAttr(item.id)}" class="paragraph-card editable-card${active}" data-item-id="${escapeAttr(item.id)}" data-type="${escapeAttr(item.type)}"${captionKind}>
        <label class="edit-label">段落 ${escapeHtml(item.id)} · ${escapeHtml(typeLabel(item.type))}</label>
        <textarea class="paper-edit-textarea" data-edit-id="${escapeAttr(item.id)}">${escapeHtml(text)}</textarea>
        ${active ? renderParagraphSourceBox(item) : ""}
      </article>
    `;
  }
  return `
    <article id="item-${escapeAttr(item.id)}" class="paragraph-card${active}" data-item-id="${escapeAttr(item.id)}" data-type="${escapeAttr(item.type)}"${captionKind}>
      <p class="paragraph-text">${renderInlineText(text, state.query)}</p>
      ${active ? renderParagraphSourceBox(item) : ""}
    </article>
  `;
}

function renderImageBlock(item, active) {
  const image = item.image || {};
  const alt = image.alt || item.text || "论文图片";
  return `
    <figure id="item-${escapeAttr(item.id)}" class="paragraph-card paper-figure${active}" data-item-id="${escapeAttr(item.id)}" data-type="image">
      <img src="${escapeAttr(image.src || "")}" alt="${escapeAttr(alt)}" loading="lazy">
      ${active ? renderParagraphSourceBox(item) : ""}
    </figure>
  `;
}

function renderTableBlock(item, active) {
  const rows = getItemRows(item);
  const body = rows
    .map((row, rowIndex) => {
      const cellTag = rowIndex === 0 ? "th" : "td";
      return `
        <tr>
          ${row
            .map((cell, cellIndex) =>
              state.editMode
                ? `<${cellTag} contenteditable="true" data-table-edit-id="${escapeAttr(item.id)}" data-row-index="${rowIndex}" data-cell-index="${cellIndex}">${escapeHtml(cell)}</${cellTag}>`
                : `<${cellTag}>${renderInlineText(cell, state.query)}</${cellTag}>`
            )
            .join("")}
        </tr>
      `;
    })
    .join("");
  return `
    <article id="item-${escapeAttr(item.id)}" class="paragraph-card paper-table-block${active}${state.editMode ? " editable-card" : ""}" data-item-id="${escapeAttr(item.id)}" data-type="table">
      ${state.editMode ? `<div class="edit-label">表格 ${escapeHtml(item.id)} · 点击单元格直接修改</div>` : ""}
      <div class="paper-table-wrap">
        <table class="paper-table">
          <tbody>${body}</tbody>
        </table>
      </div>
      ${active ? renderParagraphSourceBox(item) : ""}
    </article>
  `;
}

function renderParagraphSourceBox(item) {
  const refs = item.citations.map(getReference).filter(Boolean);
  return `
    <aside class="paragraph-source-box" aria-label="段落来源">
      <div class="source-box-title">
        <strong>段落来源</strong>
        <span>${refs.length ? `${refs.length} 篇引用文献` : "无直接引用"}</span>
      </div>
      ${
        refs.length
          ? refs.map((ref) => renderInlineSourceRef(ref, item)).join("")
          : "<p class='source-box-empty'>本段没有直接文献编号，更可能是作者自己的概括、过渡或章节组织。</p>"
      }
    </aside>
  `;
}

function renderInlineSourceRef(ref, activeItem) {
  const source = ref.localSource;
  const sourceParagraph = source?.paragraphs?.length
    ? rankedSourceParagraphs(source.paragraphs, activeItem)[0]
    : null;
  return `
    <section class="source-box-ref">
      <div class="source-box-ref-title">
        <span class="ref-number">[${ref.number}]</span>
        <span>${escapeHtml(compactRef(ref.text, 96))}</span>
      </div>
      <div class="source-box-meta">
        ${ref.journal ? `<span>${escapeHtml(ref.journal)}</span>` : ""}
        ${ref.year ? `<span>${ref.year}</span>` : ""}
        ${ref.doi ? `<span>DOI: ${escapeHtml(ref.doi)}</span>` : ""}
      </div>
      ${
        sourceParagraph
          ? `
            <blockquote>
              <b>原文位置：来源段落 ${sourceParagraph.index}</b>
              ${escapeHtml(sourceParagraph.text)}
            </blockquote>
          `
          : `
            <p class="source-box-missing">本地尚未收录该文献全文，当前只能定位到参考文献条目；补充 PDF/HTML 后可显示原文段落。</p>
          `
      }
    </section>
  `;
}

function renderEvidenceMatrix() {
  const themes = data.evidenceThemes || [];
  const maxParagraphs = Math.max(1, ...themes.map((theme) => theme.paragraphCount || 0));
  $("#evidence-matrix").innerHTML = themes
    .map((theme) => {
      const active = state.themeId === theme.id ? " is-active" : "";
      const width = Math.max(5, Math.round(((theme.paragraphCount || 0) / maxParagraphs) * 100));
      const refs = (theme.topReferences || [])
        .slice(0, 5)
        .map((number) => `<button class="citation-chip" type="button" data-ref-number="${number}">[${number}]</button>`)
        .join("");
      return `
        <article class="evidence-card${active}">
          <button class="evidence-main" type="button" data-theme-id="${escapeAttr(theme.id)}">
            <span class="evidence-name">${escapeHtml(theme.name)}</span>
            <span class="evidence-desc">${escapeHtml(theme.description)}</span>
            <span class="evidence-stats">
              <b>${theme.paragraphCount || 0}</b> 段 · <b>${theme.referenceCount || 0}</b> 篇文献
            </span>
            <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
          </button>
          ${refs ? `<div class="evidence-refs">${refs}</div>` : ""}
        </article>
      `;
    })
    .join("") || "<div class='empty-state'>暂无证据主题。</div>";
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
        <button class="network-ref" type="button" data-ref-number="${ref.number}">
          <span class="network-ref-head"><b>[${ref.number}]</b><em>${ref.usageCount} 次</em></span>
          <span class="network-ref-title">${escapeHtml(compactRef(ref.text))}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
        </button>
      `;
    })
    .join("");
  const themeRows = (data.evidenceThemes || [])
    .filter((theme) => theme.referenceCount > 0)
    .slice(0, 8)
    .map((theme) => {
      const refs = (theme.topReferences || [])
        .slice(0, 4)
        .map((number) => `<button class="citation-chip" type="button" data-ref-number="${number}">[${number}]</button>`)
        .join("");
      return `
        <div class="network-theme-row">
          <button type="button" data-theme-id="${escapeAttr(theme.id)}">${escapeHtml(theme.name)}</button>
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

function renderReferenceDetail() {
  const container = $("#reference-detail");
  const active = data.items.find((item) => item.id === state.activeItemId);
  if (!active) {
    if (state.focusRef) {
      const ref = getReference(state.focusRef);
      $("#active-paragraph-label").textContent = `正在反查文献 [${state.focusRef}]`;
      container.classList.remove("empty");
      container.innerHTML = `
        <article class="active-quote">当前筛选：所有引用文献 [${state.focusRef}] 的段落。</article>
        ${ref ? renderRefCard(ref) : `<div class="empty-state">参考文献 [${state.focusRef}] 未在文末文献表中找到。</div>`}
      `;
      return;
    }
    $("#active-paragraph-label").textContent = "尚未选择段落";
    container.classList.add("empty");
    container.textContent = "点击正文任意段落，这里会显示该段涉及的参考文献、DOI 和被引用位置。";
    return;
  }

  $("#active-paragraph-label").textContent = `${active.sectionTitle} · ${active.id}`;
  container.classList.remove("empty");
  const refs = active.citations.map(getReference);
  container.innerHTML = `
    <p class="active-quote">${escapeHtml(displayItemText(active))}</p>
    ${
      refs.length
        ? refs.map((ref, index) => (ref ? renderRefCard(ref, active) : missingRefCard(active.citations[index]))).join("")
        : "<div class='empty-state'>本段没有直接标注文献编号。它更可能是过渡、概括或章节组织段。</div>"
    }
  `;
}

function renderBibliography() {
  const query = state.refQuery.toLowerCase();
  const refs = data.references.filter((ref) => {
    if (!query) return true;
    return `${ref.number} ${ref.text} ${ref.doi || ""} ${ref.journal || ""}`.toLowerCase().includes(query);
  });
  $("#bibliography-list").innerHTML = refs
    .map((ref) => {
      const active = state.focusRef === ref.number ? " is-active" : "";
      return `
        <article class="bibliography-item${active}">
          <button type="button" data-ref-number="${ref.number}">
            <strong>[${ref.number}]</strong>
            <p>${escapeHtml(ref.text)}</p>
            <small>${ref.usageCount || 0} 个正文位置引用${ref.doi ? ` · DOI: ${escapeHtml(ref.doi)}` : ""}</small>
          </button>
        </article>
      `;
    })
    .join("") || "<div class='empty-state'>未找到匹配参考文献。</div>";
}

function renderRefCard(ref, activeItem = null) {
  const doiLink = ref.doi ? `<a href="https://doi.org/${escapeAttr(ref.doi)}" target="_blank" rel="noreferrer">${escapeHtml(ref.doi)}</a>` : "无 DOI";
  return `
    <article class="ref-card">
      <div><span class="ref-number">[${ref.number}]</span></div>
      <div class="ref-text">${escapeHtml(ref.text)}</div>
      <div class="ref-meta">
        ${ref.year ? `<span>${ref.year}</span>` : ""}
        ${ref.journal ? `<span>${escapeHtml(ref.journal)}</span>` : ""}
        <span>正文引用 ${ref.usageCount || 0} 次</span>
        <span>DOI: ${doiLink}</span>
      </div>
      ${renderSourceEvidence(ref, activeItem)}
    </article>
  `;
}

function renderSourceEvidence(ref, activeItem) {
  const source = ref.localSource;
  if (!source?.paragraphs?.length) {
    return `
      <div class="source-evidence missing">
        <strong>原文段落定位</strong>
        <p>本地尚未收录该文献全文，当前只能定位到参考文献条目；补充该论文 PDF/HTML 后可显示具体来源段落。</p>
      </div>
    `;
  }
  const paragraphs = rankedSourceParagraphs(source.paragraphs, activeItem).slice(0, 3);
  return `
    <div class="source-evidence">
      <strong>原文段落定位</strong>
      <p class="source-file">本地来源：${escapeHtml(source.title || source.file || "local source")}</p>
      ${paragraphs
        .map(
          (paragraph) => `
            <blockquote>
              <span>来源段落 ${paragraph.index}</span>
              ${escapeHtml(paragraph.text)}
            </blockquote>
          `
        )
        .join("")}
    </div>
  `;
}

function rankedSourceParagraphs(paragraphs, activeItem) {
  if (!activeItem) return paragraphs.slice(0, 3);
  const terms = sourceTermsForItem(activeItem);
  return [...paragraphs]
    .map((paragraph) => ({ ...paragraph, score: scoreSourceParagraph(paragraph.text, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5);
}

function sourceTermsForItem(item) {
  const base = [...String(item.text || "").matchAll(/[A-Za-z][A-Za-z0-9-]{1,}/g)].map((match) => match[0].toLowerCase());
  const topicTerms = {
    evaluation: ["benchmark", "metric", "statistics", "sample", "reproducibility"],
    scaling: ["scaling", "channel", "nanoribbon", "width", "gate", "electrostatic"],
    contact: ["contact", "resistance", "schottky", "metal", "injection"],
    dielectric: ["dielectric", "eot", "hfo", "gate", "leakage", "hysteresis"],
    polarity: ["pfet", "nfet", "wse", "mote", "doping", "complementary", "cmos"],
    wafer: ["wafer", "transfer", "growth", "etching", "uniformity", "fabrication"],
    circuit: ["circuit", "logic", "processor", "risc", "inverter"],
    m3d: ["monolithic", "3d", "back-end-of-line", "vertical", "stacked", "transfer"],
    sensing: ["sensing", "sensor", "optoelectronic", "vision", "flash"]
  };
  for (const topic of item.topics || []) base.push(...(topicTerms[topic] || []));
  return [...new Set(base.filter((term) => term.length > 2))];
}

function scoreSourceParagraph(text, terms) {
  const lowered = String(text || "").toLowerCase();
  return terms.reduce((score, term) => score + (lowered.includes(term) ? 1 : 0), 0);
}

function missingRefCard(number) {
  return `<article class="ref-card"><span class="ref-number">[${number}]</span><div class="ref-text">文末参考文献表中未找到该编号。</div></article>`;
}

function getReference(number) {
  return data.references.find((ref) => ref.number === Number(number));
}

function isDescendantSection(childId, ancestorId) {
  let section = data.sections.find((item) => item.id === childId);
  while (section && section.parentId) {
    if (section.parentId === ancestorId) return true;
    section = data.sections.find((item) => item.id === section.parentId);
  }
  return false;
}

function totalCitationCount() {
  return data.items.reduce((sum, item) => sum + item.citations.length, 0);
}

function typeLabel(type) {
  return {
    heading: "标题",
    meta: "元信息",
    background: "背景",
    analysis: "分析",
    evidence: "证据",
    synthesis: "归纳",
    "figure-table": "图题/表题",
    image: "图片",
    table: "表格"
  }[type] || type;
}

function displayItemText(item) {
  if (item.kind === "image") {
    return `图片：${item.image?.alt || getItemText(item) || item.id}`;
  }
  if (item.kind === "table") {
    const rows = getItemRows(item);
    const header = rows[0]?.join(" / ") || "未识别表头";
    return `表格：${header}（${rows.length} 行）`;
  }
  return getItemText(item);
}

function loadPaperEdits() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PAPER_EDIT_KEY) || "{}");
    if (parsed.sourceFile !== data?.meta?.sourceFile) {
      return { sourceFile: data?.meta?.sourceFile || null, items: {}, updatedAt: null };
    }
    return {
      sourceFile: parsed.sourceFile || data?.meta?.sourceFile || null,
      items: parsed.items && typeof parsed.items === "object" ? parsed.items : {},
      updatedAt: parsed.updatedAt || null
    };
  } catch {
    return { sourceFile: data?.meta?.sourceFile || null, items: {}, updatedAt: null };
  }
}

function savePaperEdits() {
  state.edits.sourceFile = data.meta.sourceFile;
  state.edits.updatedAt = new Date().toISOString();
  localStorage.setItem(PAPER_EDIT_KEY, JSON.stringify(state.edits));
  updateEditStatus();
}

function getItemEdit(itemId) {
  return state.edits.items?.[itemId] || {};
}

function getItemText(item) {
  const edit = getItemEdit(item.id);
  if (edit.text != null) return edit.text;
  if (item.kind === "table" && Array.isArray(edit.rows)) {
    return edit.rows.map((row) => row.join(" | ")).join("\n");
  }
  return item.text ?? "";
}

function getItemRows(item) {
  return getItemEdit(item.id).rows || item.rows || [];
}

function updatePaperTextEdit(itemId, text) {
  state.edits.items[itemId] = { ...getItemEdit(itemId), text };
  savePaperEdits();
}

function updatePaperTableEdit(itemId, rowIndex, cellIndex, text) {
  const item = data.items.find((entry) => entry.id === itemId);
  if (!item || !Number.isFinite(rowIndex) || !Number.isFinite(cellIndex)) return;
  const rows = getItemRows(item).map((row) => [...row]);
  if (!rows[rowIndex]) rows[rowIndex] = [];
  rows[rowIndex][cellIndex] = text.trim();
  state.edits.items[itemId] = { ...getItemEdit(itemId), rows, text: rows.map((row) => row.join(" | ")).join("\n") };
  savePaperEdits();
}

function updateEditStatus() {
  const count = Object.keys(state.edits.items || {}).length;
  setText("#edit-status", `${state.editMode ? "编辑模式" : "只读模式"} · ${count} 处修改`);
  const toggle = $("#toggle-edit");
  if (toggle) toggle.textContent = state.editMode ? "退出编辑" : "编辑论文";
}

function exportPaperEdits() {
  const payload = {
    type: "paper-edits",
    sourceFile: data.meta.sourceFile,
    exportedAt: new Date().toISOString(),
    edits: state.edits
  };
  downloadJson(payload, `paper-edits-${Date.now()}.json`);
}

function importPaperEditsFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const imported = parsed.edits || parsed;
      if (!imported.items || typeof imported.items !== "object") {
        throw new Error("JSON 中没有 items 修改数据。");
      }
      const importedSourceFile = parsed.sourceFile || imported.sourceFile;
      if (importedSourceFile && importedSourceFile !== data.meta.sourceFile) {
        throw new Error("导入文件对应的 DOCX 源文件与当前网页不一致。");
      }
      state.edits = {
        sourceFile: data.meta.sourceFile,
        items: imported.items,
        updatedAt: new Date().toISOString()
      };
      savePaperEdits();
      renderAll();
      syncControlsFromState();
      window.alert("论文修改已导入。");
    } catch (error) {
      window.alert(`导入失败：${error.message}`);
    }
  });
  reader.readAsText(file, "utf-8");
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

function themeName(themeId) {
  const theme = (data.evidenceThemes || []).find((item) => item.id === themeId);
  return theme?.name || themeId;
}

function compactHeading(text) {
  return text.length > 18 ? text.slice(0, 18) + "..." : text;
}

function compactRef(text, limit = 76) {
  const cleaned = String(text || "").replace(/\s*DOI:\s*10\..*$/i, "").trim();
  return cleaned.length > limit ? cleaned.slice(0, limit) + "..." : cleaned;
}

function renderInlineText(text, query) {
  const citationPattern = /\[([0-9]+(?:\s*[-–—,，]\s*[0-9]+)*)\]/g;
  let output = "";
  let lastIndex = 0;
  for (const match of text.matchAll(citationPattern)) {
    output += highlight(text.slice(lastIndex, match.index), query);
    const numbers = expandCitationText(match[1]);
    output += numbers.length
      ? `<span class="inline-citations">${numbers.map((number) => `<button type="button" data-ref-number="${number}">[${number}]</button>`).join("")}</span>`
      : escapeHtml(match[0]);
    lastIndex = match.index + match[0].length;
  }
  output += highlight(text.slice(lastIndex), query);
  return output;
}

function expandCitationText(raw) {
  const numbers = [];
  String(raw)
    .split(/\s*[,，]\s*/)
    .forEach((part) => {
      if (/[-–—]/.test(part)) {
        const bounds = part.split(/\s*[-–—]\s*/).map(Number).filter(Number.isFinite);
        if (bounds.length === 2) {
          const start = Math.min(bounds[0], bounds[1]);
          const end = Math.max(bounds[0], bounds[1]);
          for (let number = start; number <= end; number += 1) numbers.push(number);
        }
      } else {
        const number = Number(part);
        if (Number.isFinite(number)) numbers.push(number);
      }
    });
  return [...new Set(numbers)];
}

function highlight(text, query) {
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(new RegExp(safeQuery, "gi"), (match) => `<span class="mark">${match}</span>`);
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

function scrollToReadingPanel() {
  $(".reading-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
