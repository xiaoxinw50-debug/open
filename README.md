# 论文交互可视化站

这个站点用于把《后摩尔时代的二维半导体电子技术》主稿转成可交互阅读界面。

## 功能

- `index.html` 是传统论文阅读页，打开后直接显示正文，整体接近 WPS/Word 论文阅读观感。
- 点击正文段落，在右侧显示该段引用的参考文献、DOI、期刊和正文引用次数。
- 若本地已收录对应论文 HTML/PDF 解析文本，右侧会显示“来源段落”编号和短摘录；未收录全文的文献会标记为待定位。
- 点击参考文献，反查全文中引用该文献的段落。
- `map.html` 单独展示论文思维导图、逻辑结构、证据矩阵和引用网络。
- 支持全文关键词检索、段落类型筛选。
- 数据来自 DOCX 自动解析，后续换稿只需重新生成 `data/paper-data.js`。

## 更新数据

默认读取上一级目录中的主稿：

```bash
python3 scripts/build_paper_data.py
```

也可以指定其他 DOCX：

```bash
python3 scripts/build_paper_data.py "/Users/xuyingxin/Desktop/二维半导体技术/后摩尔时代二维半导体电子技术_行文逻辑优化版.docx"
```

## 本地预览

```bash
python3 -m http.server 5177
```

然后打开：

```text
http://127.0.0.1:5177/
```

## 设计说明

这是静态网站，不依赖后端。核心数据结构保存在 `data/paper-data.js`，适合直接部署到 GitHub Pages、Render Static Site 或普通服务器。
