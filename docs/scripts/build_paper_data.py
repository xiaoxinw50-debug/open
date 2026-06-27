#!/usr/bin/env python3
"""Extract manuscript structure from a DOCX file for the paper visualization site."""

from __future__ import annotations

import json
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
DEFAULT_DOCX = WORKSPACE / "后摩尔时代二维半导体电子技术_行文逻辑优化版.docx"
OUTPUT = ROOT / "data" / "paper-data.js"
SOURCE_DIR = WORKSPACE / "近期IEEE_Nature补充_20260612" / "papers"
MEDIA_OUTPUT_DIR = ROOT / "assets" / "docx-media"

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}
CITATION_RE = re.compile(r"\[([0-9]+(?:\s*[-–—,，]\s*[0-9]+)*)\]")
HEADING_RE = re.compile(r"^([1-9](?:\.\d+)*)\s+(.+)$")
FIGURE_RE = re.compile(r"^(图|表|续表)\s*([0-9一二三四五六七八九十]+)")
APPENDIX_TABLE_RE = re.compile(r"^附表\s*[A-Za-z0-9]+")
REF_RE = re.compile(r"^\[(\d+)\]\s*(.+)$")
DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+")

EVIDENCE_THEMES = [
    {
        "id": "evaluation",
        "name": "评价口径",
        "description": "指标、测试条件、样本数量和可复核性，是综述主线的组织骨架。",
        "keywords": ["评价口径", "报告规范", "测试条件", "可复核", "样本数量", "良率", "统计分布", "数据口径", "开关裕量"],
    },
    {
        "id": "scaling",
        "name": "短沟道与栅控",
        "description": "二维沟道是否能在微缩后维持 SS、DIBL、漏电和驱动能力。",
        "keywords": ["短沟道", "栅控", "微缩", "SS", "DIBL", "沟道缩短", "亚阈值摆幅", "等效氧化层厚度"],
    },
    {
        "id": "contact",
        "name": "接触工程",
        "description": "低接触电阻、接触长度缩放和费米能级钉扎直接决定材料优势能否转成电流。",
        "keywords": ["接触电阻", "低阻接触", "接触长度", "Rc", "肖特基", "费米能级", "空穴接触", "注入势垒"],
    },
    {
        "id": "dielectric",
        "name": "栅介质与界面",
        "description": "超薄介质、界面陷阱、漏电、迟滞和击穿共同决定栅堆栈是否可用。",
        "keywords": ["栅介质", "HfO", "EOT", "迟滞", "界面陷阱", "栅堆栈", "栅漏电", "击穿"],
    },
    {
        "id": "polarity",
        "name": "互补极性",
        "description": "n 型和 p 型器件是否能配对，是二维 CMOS 从单管走向线路的关键。",
        "keywords": ["p 型", "n 型", "互补", "CMOS", "WSe", "MoTe", "掺杂", "阈值匹配", "空穴"],
    },
    {
        "id": "wafer",
        "name": "晶圆制造",
        "description": "生长、转移、图形化、刻蚀和参数分布决定结果能否跨样品重复。",
        "keywords": ["晶圆", "晶圆级", "wafer", "直接生长", "干法转移", "图形化", "刻蚀", "大面积", "均匀性", "参数分布", "制造"],
    },
    {
        "id": "circuit",
        "name": "电路与系统",
        "description": "反相器、逻辑模块、处理器和标准单元把器件优势放进系统约束中检验。",
        "keywords": ["电路", "逻辑模块", "反相器", "微处理器", "RISC", "标准单元", "处理器"],
    },
    {
        "id": "m3d",
        "name": "单片三维集成",
        "description": "二维材料的低温、超薄和可转移特性，可能首先在后道垂直集成中体现价值。",
        "keywords": ["单片三维", "monolithic 3D", "后道", "BEOL", "垂直集成", "异质集成", "器件堆叠", "转移印刷"],
    },
    {
        "id": "sensing",
        "name": "功能融合",
        "description": "传感、光电、存储和感存算融合体现二维材料 more than Moore 的扩展价值。",
        "keywords": ["传感", "集成感知", "光电", "人工视觉", "探测器", "存储", "flash", "感存算"],
    },
]


class BlockHTMLParser(HTMLParser):
    block_tags = {"p", "h1", "h2", "h3", "h4", "li", "figcaption"}
    skip_tags = {"script", "style", "noscript", "svg"}

    def __init__(self) -> None:
        super().__init__()
        self.blocks: list[str] = []
        self.current: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.skip_tags:
            self.skip_depth += 1
        if tag in self.block_tags and not self.skip_depth:
            self.flush()

    def handle_endtag(self, tag: str) -> None:
        if tag in self.block_tags and not self.skip_depth:
            self.flush()
        if tag in self.skip_tags and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        text = normalize_text(data)
        if text:
            self.current.append(text)

    def flush(self) -> None:
        text = normalize_text(" ".join(self.current))
        if is_useful_source_paragraph(text):
            self.blocks.append(text)
        self.current = []


def text_from_node(node: ET.Element) -> str:
    texts = [item.text or "" for item in node.findall(".//w:t", NS)]
    return "".join(texts).strip()


def iter_docx_blocks(docx_path: Path) -> list[dict]:
    with ZipFile(docx_path) as archive:
        image_relationships = read_image_relationships(archive)
        image_sources = export_docx_images(archive, image_relationships)
        root = ET.fromstring(archive.read("word/document.xml"))
    body = root.find(".//w:body", NS)
    if body is None:
        return []

    blocks: list[dict] = []
    for child in list(body):
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            text = text_from_node(child)
            image_blocks = image_blocks_from_paragraph(child, image_sources)
            if text:
                blocks.append({"kind": "paragraph", "text": normalize_text(text)})
            blocks.extend(image_blocks)
        elif tag == "tbl":
            rows = []
            for row in child.findall(".//w:tr", NS):
                cells = []
                for cell in row.findall("./w:tc", NS):
                    cell_text = normalize_text(text_from_node(cell))
                    if cell_text:
                        cells.append(cell_text)
                if cells:
                    rows.append(cells)
            if rows:
                blocks.append({"kind": "table", "rows": rows, "text": "\n".join(" | ".join(r) for r in rows)})
    return blocks


def read_image_relationships(archive: ZipFile) -> dict[str, str]:
    rels: dict[str, str] = {}
    try:
        rels_root = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
    except KeyError:
        return rels
    for rel in rels_root.findall("pr:Relationship", NS):
        rel_type = rel.attrib.get("Type", "")
        if "relationships/image" not in rel_type:
            continue
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        if rel_id and target:
            rels[rel_id] = "word/" + target.lstrip("/")
    return rels


def export_docx_images(archive: ZipFile, image_relationships: dict[str, str]) -> dict[str, dict]:
    if MEDIA_OUTPUT_DIR.exists():
        shutil.rmtree(MEDIA_OUTPUT_DIR)
    MEDIA_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    exported: dict[str, dict] = {}
    for rel_id, archive_name in image_relationships.items():
        if archive_name not in archive.namelist():
            continue
        suffix = Path(archive_name).suffix.lower() or ".png"
        filename = f"{rel_id}{suffix}"
        output_path = MEDIA_OUTPUT_DIR / filename
        output_path.write_bytes(archive.read(archive_name))
        exported[rel_id] = {
            "relId": rel_id,
            "archiveName": archive_name,
            "src": f"assets/docx-media/{filename}",
            "filename": filename,
        }
    return exported


def image_blocks_from_paragraph(paragraph: ET.Element, image_sources: dict[str, dict]) -> list[dict]:
    blocks: list[dict] = []
    for blip in paragraph.findall(".//a:blip", NS):
        rel_id = blip.attrib.get(f"{{{NS['r']}}}embed")
        if not rel_id or rel_id not in image_sources:
            continue
        doc_pr = paragraph.find(".//wp:docPr", NS)
        alt_text = ""
        if doc_pr is not None:
            alt_text = doc_pr.attrib.get("descr") or doc_pr.attrib.get("name") or ""
        image = dict(image_sources[rel_id])
        image["alt"] = alt_text
        blocks.append({"kind": "image", "text": alt_text or f"图片 {rel_id}", "image": image})
    return blocks


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalize_doi(doi: str) -> str:
    return doi.strip().rstrip(".").lower()


def is_useful_source_paragraph(text: str) -> bool:
    if len(text) < 90 or len(text) > 2200:
        return False
    lowered = text.lower()
    blocked = [
        "thank you for visiting",
        "skip to main content",
        "advertisement",
        "download pdf",
        "rights and permissions",
        "springer nature",
        "cookies",
        "sign up for",
        "full size image",
        "alternative text for this image",
        "you are using a browser version",
        "author contributions",
        "competing interests",
        "correspondence and requests",
        "peer review",
        "publisher's note",
        "conceived the project",
        "reprints and permissions",
        "supplementary information",
        "data availability",
        "code availability",
        "acknowledgements",
    ]
    return not any(key in lowered for key in blocked)


def expand_citations(raw: str) -> list[int]:
    numbers: list[int] = []
    parts = re.split(r"\s*[,，]\s*", raw)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if re.search(r"[-–—]", part):
            bounds = [int(x) for x in re.split(r"\s*[-–—]\s*", part) if x.isdigit()]
            if len(bounds) == 2:
                start, end = sorted(bounds)
                numbers.extend(range(start, end + 1))
        elif part.isdigit():
            numbers.append(int(part))
    return sorted(set(numbers))


def citations_from_text(text: str) -> list[int]:
    citations: list[int] = []
    for match in CITATION_RE.finditer(text):
        citations.extend(expand_citations(match.group(1)))
    return sorted(set(citations))


def caption_kind_from_text(text: str) -> str:
    if APPENDIX_TABLE_RE.match(text):
        return "table"

    match = FIGURE_RE.match(text)
    if not match:
        return ""

    label = match.group(1)
    rest = text[match.end() :].strip()
    if label == "图":
        bridge_starts = ("展示", "所示", "中", "更", "主要", "集中", "把", "用于")
        if rest.startswith(bridge_starts) and "来源" not in text:
            return ""
        return "figure"

    bridge_starts = ("将", "只是", "进一步", "显示", "给出")
    if rest.startswith(bridge_starts) and "来源" not in text:
        return ""
    return "table"


def classify_block(text: str, current_section: str) -> str:
    if HEADING_RE.match(text):
        return "heading"
    if text in {"摘要", "关键词", "英文摘要", "Abstract"} or text.startswith("Keywords:"):
        return "meta"
    if caption_kind_from_text(text):
        return "figure-table"
    if any(key in text for key in ["结论", "挑战", "路线", "展望"]):
        return "synthesis"
    if any(key in text for key in ["接触", "栅介质", "短沟道", "p 型", "n 型", "晶圆", "单片三维"]):
        return "evidence"
    if any(key in current_section for key in ["引言", "背景"]):
        return "background"
    return "analysis"


def classify_item(kind: str, text: str, current_section: str) -> str:
    if kind == "image":
        return "image"
    if kind == "table":
        return "table"
    return classify_block(text, current_section)


def topics_from_text(text: str) -> list[str]:
    lowered = text.lower()
    topics: list[str] = []
    for theme in EVIDENCE_THEMES:
        for keyword in theme["keywords"]:
            if keyword.lower() in lowered:
                topics.append(theme["id"])
                break
    return topics


def short_label(text: str, max_len: int = 34) -> str:
    text = re.sub(r"\[[0-9,，\-–—\s]+\]", "", text)
    return text if len(text) <= max_len else text[:max_len] + "..."


def build_sections_and_items(blocks: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    sections: list[dict] = []
    items: list[dict] = []
    references: list[dict] = []
    heading_stack: dict[int, dict] = {}
    current_section = {"id": "front", "title": "题名、摘要与关键词", "level": 0}
    sections.append(current_section)
    in_references = False
    reference_buffer: dict | None = None

    for raw_index, block in enumerate(blocks, start=1):
        text = block["text"]
        if text == "参考文献":
            in_references = True
            if reference_buffer:
                references.append(reference_buffer)
            reference_buffer = None
            continue

        if in_references:
            match = REF_RE.match(text)
            if match:
                if reference_buffer:
                    references.append(reference_buffer)
                reference_buffer = {
                    "number": int(match.group(1)),
                    "text": match.group(2).strip(),
                    "doi": extract_doi(text),
                    "year": extract_year(text),
                    "journal": extract_journal(text),
                }
            elif reference_buffer:
                reference_buffer["text"] = normalize_text(reference_buffer["text"] + " " + text)
                reference_buffer["doi"] = reference_buffer["doi"] or extract_doi(reference_buffer["text"])
                reference_buffer["year"] = reference_buffer["year"] or extract_year(reference_buffer["text"])
                reference_buffer["journal"] = extract_journal(reference_buffer["text"])
            continue

        heading_match = HEADING_RE.match(text)
        if heading_match:
            number = heading_match.group(1)
            level = number.count(".") + 1
            section = {
                "id": f"s{len(sections)}",
                "number": number,
                "title": heading_match.group(2).strip(),
                "fullTitle": text,
                "level": level,
                "parentId": heading_stack.get(level - 1, {}).get("id", "front") if level > 1 else "root",
                "itemIds": [],
                "citationCount": 0,
            }
            sections.append(section)
            heading_stack[level] = section
            for deeper in [key for key in heading_stack if key > level]:
                heading_stack.pop(deeper, None)
            current_section = section

        citations = citations_from_text(text)
        caption_kind = caption_kind_from_text(text)
        item = {
            "id": f"p{len(items) + 1}",
            "rawIndex": raw_index,
            "kind": block["kind"],
            "type": classify_item(block["kind"], text, current_section.get("title", "")),
            "sectionId": current_section["id"],
            "sectionTitle": current_section.get("fullTitle") or current_section["title"],
            "text": text,
            "preview": short_label(text),
            "citations": citations,
            "topics": topics_from_text(text),
        }
        if caption_kind:
            item["captionKind"] = caption_kind
        if block["kind"] == "table":
            item["rows"] = block.get("rows", [])
        if block["kind"] == "image":
            item["image"] = block.get("image", {})
        items.append(item)
        current_section.setdefault("itemIds", []).append(item["id"])
        current_section["citationCount"] = current_section.get("citationCount", 0) + len(citations)

    if reference_buffer:
        references.append(reference_buffer)

    return sections, items, references


def extract_doi(text: str) -> str:
    match = DOI_RE.search(text)
    return match.group(0).rstrip(".") if match else ""


def extract_year(text: str) -> int | None:
    matches = re.findall(r"\b(20\d{2}|19\d{2})\b", text)
    if not matches:
        return None
    return int(matches[-1])


def extract_journal(text: str) -> str:
    match = re.search(r"\[J(?:/OL)?\]\.\s*([^,]+)", text)
    if match:
        return match.group(1).strip()
    match = re.search(r"\[C\]//\s*([^,]+)", text)
    return match.group(1).strip() if match else ""


def build_reference_usage(items: list[dict], references: list[dict]) -> None:
    usage: dict[int, list[str]] = {}
    for item in items:
        for number in item["citations"]:
            usage.setdefault(number, []).append(item["id"])
    for ref in references:
        ref["usedBy"] = usage.get(ref["number"], [])
        ref["usageCount"] = len(ref["usedBy"])


def load_local_source_documents() -> dict[str, dict]:
    docs: dict[str, dict] = {}
    if not SOURCE_DIR.exists():
        return docs

    for path in sorted(SOURCE_DIR.glob("*.html")):
        if "irrelevant" in path.name:
            continue
        raw = path.read_text(encoding="utf-8", errors="ignore")
        parser = BlockHTMLParser()
        parser.feed(raw)
        parser.flush()
        full_text = " ".join(parser.blocks)
        doi_matches = [normalize_doi(doi) for doi in DOI_RE.findall(full_text)]
        if not doi_matches:
            continue
        doi = doi_matches[0]
        paragraphs = [
            {"index": index, "text": short_source_excerpt(paragraph)}
            for index, paragraph in enumerate(dedupe_preserve_order(parser.blocks), start=1)
        ][:90]
        if not paragraphs:
            continue
        title = html_title(raw) or clean_source_title(paragraphs[0]["text"], path)
        docs[doi] = {
            "doi": doi,
            "title": title,
            "file": str(path),
            "kind": "local-html",
            "paragraphs": paragraphs,
        }
    return docs


def dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = value[:180]
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def clean_source_title(text: str, path: Path) -> str:
    title = re.sub(r"\s*\|\s*Nature.*$", "", text).strip()
    title = re.sub(r"\s*Skip to main content.*$", "", title).strip()
    return title or path.stem.replace("_", " ")


def html_title(raw: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", raw, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return ""
    return clean_source_title(normalize_text(re.sub(r"<[^>]+>", " ", match.group(1))), Path(""))


def short_source_excerpt(text: str, limit: int = 420) -> str:
    text = normalize_text(text)
    return text if len(text) <= limit else text[:limit].rstrip() + "..."


def attach_local_sources(references: list[dict]) -> None:
    docs = load_local_source_documents()
    for ref in references:
        doi = normalize_doi(ref.get("doi", ""))
        if doi and doi in docs:
            ref["localSource"] = docs[doi]


def build_argument_map(sections: list[dict]) -> dict:
    level1 = [s for s in sections if s.get("level") == 1]
    level2 = [s for s in sections if s.get("level") == 2]
    nodes = []
    for section in level1:
        children = [child for child in level2 if child.get("parentId") == section["id"]]
        nodes.append(
            {
                "id": section["id"],
                "label": section.get("fullTitle", section["title"]),
                "citationCount": section.get("citationCount", 0),
                "children": [
                    {
                        "id": child["id"],
                        "label": child.get("fullTitle", child["title"]),
                        "citationCount": child.get("citationCount", 0),
                    }
                    for child in children
                ],
            }
        )
    return {
        "center": "二维半导体的价值不只在材料很薄，而在沟道优势能否经过接触、介质、互补器件、晶圆制造和系统验证连续保留下来。",
        "nodes": nodes,
    }


def build_evidence_themes(items: list[dict], references: list[dict]) -> list[dict]:
    ref_by_number = {ref["number"]: ref for ref in references}
    themes = []
    for theme in EVIDENCE_THEMES:
        matched_items = [item for item in items if theme["id"] in item.get("topics", [])]
        citation_numbers = sorted({number for item in matched_items for number in item.get("citations", [])})
        top_refs = sorted(
            (ref_by_number[number] for number in citation_numbers if number in ref_by_number),
            key=lambda ref: ref.get("usageCount", 0),
            reverse=True,
        )[:8]
        themes.append(
            {
                "id": theme["id"],
                "name": theme["name"],
                "description": theme["description"],
                "keywords": theme["keywords"],
                "itemIds": [item["id"] for item in matched_items],
                "paragraphCount": len(matched_items),
                "citationNumbers": citation_numbers,
                "referenceCount": len(citation_numbers),
                "topReferences": [ref["number"] for ref in top_refs],
            }
        )
    return themes


def build_data(docx_path: Path) -> dict:
    blocks = iter_docx_blocks(docx_path)
    sections, items, references = build_sections_and_items(blocks)
    build_reference_usage(items, references)
    attach_local_sources(references)
    cited_numbers = sorted({number for item in items for number in item["citations"]})
    references_by_number = {ref["number"]: ref for ref in references}
    missing_refs = [number for number in cited_numbers if number not in references_by_number]
    title = next((item["text"] for item in items if item["sectionId"] == "front"), "论文可视化")

    return {
        "meta": {
            "title": title,
            "sourceFile": str(docx_path),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "paragraphCount": len(items),
            "referenceCount": len(references),
            "citedReferenceCount": len(cited_numbers),
            "missingReferenceNumbers": missing_refs,
        },
        "sections": sections,
        "items": items,
        "references": references,
        "argumentMap": build_argument_map(sections),
        "evidenceThemes": build_evidence_themes(items, references),
    }


def main() -> int:
    docx_path = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else DEFAULT_DOCX
    if not docx_path.exists():
        print(f"missing DOCX: {docx_path}", file=sys.stderr)
        return 2

    data = build_data(docx_path)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    OUTPUT.write_text("window.PAPER_DATA = " + payload + ";\n", encoding="utf-8")
    print(f"wrote {OUTPUT}")
    print(
        f"items={data['meta']['paragraphCount']} refs={data['meta']['referenceCount']} "
        f"cited={data['meta']['citedReferenceCount']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
