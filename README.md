# 二维半导体开关裕量因子网站

这个网站用于整理二维半导体逻辑器件论文，计算开关裕量因子并排序。

## 公式口径

核心指标采用补充材料 S1 的器件层辅助定义：

```text
Γ2D = (|VDS| - Ion · Rc,eff) / (SS · log10(Ion/Ioff))
```

其中：

- `Ion` 输入为 `μA/μm`，计算时换算为 `mA/μm`。
- `Rc,eff` 输入为 `Ω·μm`，计算时换算为 `kΩ·μm`。
- 若论文只给出单侧接触电阻，网站按近似对称器件换算为两侧等效接触贡献。
- `SS` 输入为 `mV/dec`，计算时换算为 `V/dec`。
- `log10(Ion/Ioff)` 可直接输入；若只输入开关比，网站自动取十进制对数。

## 运行

```bash
npm install
npm start
```

然后打开：

```text
http://localhost:5177
```

## Render 部署

仓库包含 `render.yaml`。在 Render 中选择 Blueprint 并连接本仓库即可部署。

默认配置：

- Web Service: `switch-margin-site`
- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check: `/api/health`
- Auto Ingestion: 启动后自动抓取一次，之后每 6 小时抓取一次
- GitHub Actions: 每 6 小时访问线上抓取接口，用于唤醒免费 Render 实例并补充新论文

当前 Blueprint 使用 Render 免费 Web Service，便于先上线验证。免费实例可能休眠，文件存储也不是长期数据库；若要稳定保存长期自动抓取结果，建议后续升级为付费实例并挂载持久磁盘或接入数据库。

## 自动检索逻辑

后台会从 OpenAlex、Crossref 与 arXiv 检索近期相关论文，按标题、摘要、期刊和关键词筛选二维半导体逻辑器件相关条目。若找到 arXiv HTML、开放 HTML、DOI 落地页或 Unpaywall/OpenAlex 给出的开放全文入口，系统会读取多个可访问来源并合并正文，从全文中抽取 `Ion`、`Rc`、`SS`、`VDS`、开关比等参数，同时保存每个字段对应的原文证据片段、来源、段落编号和字符位置；若参数不完整，则进入“待补参数”候选库。

检索日志会显示完整过程：原始抓取条数、重复跳过条数、相关命中条数、开放全文读取篇数、全文补充参数篇数、入库/更新条数、可直接计算条数和待补参数条数。需要注意的是，Nature、IEEE 等数据库经常只开放标题和摘要，不开放完整器件表格；如果关键数值只在付费 PDF、图片或不可机器读取的表格中，网站会先把论文放入候选库，而不会编造参数。

PDF 解析目前做成可选能力：如果运行环境安装了 `pdf-parse`，系统会尝试解析开放 PDF；如果未安装，会在溯源中记录“PDF detected; optional pdf-parse parser is not installed”。这不是数据抓取失败，而是为了避免大型 PDF 解析包在 Render 构建中长时间解包，影响网站部署稳定性。系统会优先读取开放 HTML，并自动追踪页面里的 supplement、supporting information、extended data 和 PDF 链接。

自动检索默认只保留至少抽取到一个公式字段的候选论文。明显偏向存储器、传感、光电、KPFM 或综述/展望而缺少逻辑 FET benchmark 信息的结果会被过滤；看似相关但完全没有 `Ion`、`Rc`、`VDS`、`SS` 或开关比的条目会计入“无公式参数跳过”，不再塞进候选库。

候选库会显示“已算部分”：例如只有 `Ion` 和 `Rc` 时显示 `Π2D`，有 `Ion`、`Rc` 和 `VDS` 时显示带星号的接触压降试算，已有 `SS` 与开关比时显示开关电压代价。带星号的 `Vdrop*`、`Veff*` 和 `Γ2D*` 都是试算值，通常假设未知 `Rc` 口径为源漏总等效；正式排序仍只使用六个字段和 `Rc` 口径都齐全的严格 `Γ2D`。

候选库顶部提供数据诊断面板，统计严格计算、估算排序、待补参数和隐藏候选数量，并按缺失字段给出瓶颈排行。若需要排查检索噪声，可打开“显示低价值自动候选”开关，临时查看被过滤的综述、传感、光电或缺少 `Ion/Rc` 的自动候选。

自动检索页提供运行进度：前端每秒轮询 `/api/ingest/progress`，显示当前阶段、关键词、来源、正在处理的论文、抓取/全文读取/入库/可计算/待补参数计数，以及最近的跳过或保存记录。

全文读取预算会优先给已在摘要中抽到部分公式字段或明显包含参数线索的论文，减少把全文名额浪费在综述、理论、传感、光电或完全无器件 benchmark 信息的条目上。

仓库的 `.github/workflows/scheduled-ingest.yml` 会定时调用：

```text
POST https://switch-margin-site.onrender.com/api/ingest/run
```

如需限制外部调用，可同时在 Render 和 GitHub Secrets 中设置同一个 `INGEST_TOKEN`。设置后，GitHub Actions 会通过 `x-ingest-token` 请求头触发检索。

这一步不会伪造数据。遇到 IEEE、Nature 等只给元数据或摘要、不开放全文的论文，网站会先入库，等待人工补齐参数来源、图号和口径。

## 主要页面

- `排序总览`：已计算样本按 Γ2D 排序。
- `候选论文`：自动检索到但参数不足的论文。
- `手动计算`：录入单篇论文参数并立即计算。
- `自动检索`：手动触发检索、查看检索状态。

## 功能链条

网站按以下顺序工作：

1. 自动检索：定时或手动从 OpenAlex、Crossref、arXiv 抓取近期相关论文。
2. 自动计算：若论文元数据或开放文本中能抽取出 `Ion`、`Rc`、`VDS`、`SS`、开关比和 `Rc` 口径，自动计算 Γ2D；缺参数的样本进入候选库。
3. 自动排序：已计算样本按 Γ2D、Π2D、年份或相关性排序。
4. 结果输出：`排序总览` 页面可复制完整 JSON，也可下载 CSV。输出字段包括论文信息、原始参数、接触压降、有效电压余量、开关代价、Γ2D、判读和缺失字段。

机器可读接口：

```text
GET /api/rankings?sort=gamma&include=all
GET /api/diagnostics
```

## 后续可扩展

- 接入更稳定的开放 PDF 解析和图表 OCR。
- 增加 WPS/Word 附表导出。
- 增加人工审核队列与多人协作权限。
- 部署到 Render/Vercel，并用数据库替代本地 JSON 文件。
