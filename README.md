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

当前 Blueprint 使用 Render 免费 Web Service，便于先上线验证。免费实例可能休眠，文件存储也不是长期数据库；若要稳定保存长期自动抓取结果，建议后续升级为付费实例并挂载持久磁盘或接入数据库。

## 自动检索逻辑

后台会从 OpenAlex、Crossref 与 arXiv 检索近期相关论文，按标题、摘要、期刊和关键词筛选二维半导体逻辑器件相关条目。若摘要或开放文本中能识别出 `Ion`、`Rc`、`SS`、`VDS`、开关比等参数，则自动计算；若参数不完整，则进入“待补参数”候选库。

这一步不会伪造数据。遇到 IEEE、Nature 等只给元数据或摘要、不开放全文的论文，网站会先入库，等待人工补齐参数来源、图号和口径。

## 主要页面

- `排序总览`：已计算样本按 Γ2D 排序。
- `候选论文`：自动检索到但参数不足的论文。
- `手动计算`：录入单篇论文参数并立即计算。
- `自动检索`：手动触发检索、查看检索状态。

## 后续可扩展

- 接入 DOI 全文解析或本地 PDF 解析。
- 增加 WPS/Word 附表导出。
- 增加人工审核队列与多人协作权限。
- 部署到 Render/Vercel，并用数据库替代本地 JSON 文件。
