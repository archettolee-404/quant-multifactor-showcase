# 《量化交易技术理论与实践》期末小组作业展示网站

面向课程老师、答辩评委与同学的中文静态展示网站模板，兼顾 1920×1080 教室投影放映与 390 px 手机端浏览。网站采用原生 HTML / CSS / JavaScript 与本地固定版本 **Apache ECharts 5.6.0**，所有资源均为相对路径，默认呈「待导入」状态，不预载演示数据或旧版草稿数值。

---

## 一、目录结构

```text
.
├── docs/                                  # GitHub Pages 发布根目录（main 分支 /docs）
│   ├── .nojekyll                          # 关闭 Jekyll 处理，确保静态文件直出
│   ├── index.html                         # 单页入口（锚点 #home #method #backtest #product #simulation）
│   ├── assets/
│   │   ├── css/styles.css                 # 视觉与响应式样式（深蓝墨首屏 / 米白阅读背景）
│   │   ├── js/app.js                      # 数据加载、图表交互、播放缩放与错误诊断逻辑
│   │   ├── figures/                       # 放置小组审阅后的 PNG / WebP 配图与雪球截图
│   │   └── vendor/echarts/
│   │       ├── echarts.min.js             # 固定版本 Apache ECharts 5.6.0（本地离线加载）
│   │       ├── LICENSE                    # Apache-2.0 许可证
│   │       └── NOTICE                     # Apache NOTICE 声明
│   └── data/
│       └── site.json                      # 公开站点配置（标题、脱敏成员、配图、雪球与代码链接）
├── scripts/
│   └── import_backtest.py                 # Python 3 标准库 CSV 转 JSON 导入与严格校验工具
├── tests/
│   └── test_importer.py                   # 独立单元测试（验证正常导入、BOM、重复日期与原子保护）
├── previews/                              # 验收与交接用预览截图（含桌面 16:9、手机与演示截图）
├── templates/                             # 原始空样表与字段规范（勿直接暴露在 docs/）
├── project-status.md                      # 成果盘点与口径核对重点
├── files-to-prepare.md                    # 定稿前小组补件清单
└── SKILLS.md                              # 可选制作技能与官方文档参考
```

---

## 二、本地预览

在仓库根目录执行以下命令启动本地静态服务：

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory docs
```

启动后使用浏览器打开以下地址核对直达锚点：

- 首页入口：`http://127.0.0.1:8000/`
- 回测与风险直达：`http://127.0.0.1:8000/#backtest`
- 雪球模拟直达：`http://127.0.0.1:8000/#simulation`

> 提示：请勿直接双击 `docs/index.html`（`file://` 协议会被浏览器拦截 `fetch` 请求）；本地核对一律通过上述 HTTP 服务打开。

---

## 三、数据导入与字段映射（仅更新配置与数据）

小组定稿后，队员**无需修改 `index.html`、`styles.css` 或 `app.js`**，只需维护原始输入目录（放在 `docs/` 之外）并更新 `docs/data/` 与 `docs/assets/figures/`。

### 1. 导入脚本用法与样例命令

将单池原始文件（`nav.csv`、`metrics.csv`、`run-meta.json` 及可选 `turnover.csv`）置于公开目录之外（例如 `local_inputs/hs300/` 与 `local_inputs/zz500/`），支持 UTF-8 与 Excel 导出的带 BOM UTF-8：

```powershell
# 仅校验，不写入文件（推荐先试跑）
python scripts/import_backtest.py --pool hs300 --input local_inputs/hs300 --dry-run

# 导入单个股票池（支持单池独立上线，另一池保留「待导入」）
python scripts/import_backtest.py --pool hs300 --input local_inputs/hs300 --output docs/data/hs300.json
python scripts/import_backtest.py --pool zz500 --input local_inputs/zz500 --output docs/data/zz500.json

# 或批量扫描根目录（存在 hs300/ 或 zz500/ 哪个就导入哪个）
python scripts/import_backtest.py --input-root local_inputs --output-dir docs/data

# 查看完整可审计字段映射表
python scripts/import_backtest.py --show-mapping
```

脚本会检查日期格式（`YYYY-MM-DD`）、严格递增、重复日期、正有限净值、三组日期对齐、绩效列约束、`run-meta.json` 日期一致性及可选 `turnover.csv`。**全部校验通过后才会原子写入目标 JSON**；若发现错误会标明文件名与行号并中止写入，原有有效文件不受影响。

### 2. 更新 `docs/data/site.json`

1. 在 `runs` 中填入已导入股票池的相对路径（未导入的池保持 `null`）：
   ```json
   "runs": {
     "hs300": "data/hs300.json",
     "zz500": null
   }
   ```
2. 在 `members` 中按 4 个固定席位填写姓名与 `studentIdLast4`（仅 4 位尾号字符串，保留前导零；完整学号仅保存在课堂本地报告材料中）。
3. 将审阅后的 PNG/WebP 图片放入 `docs/assets/figures/`，在 `figures` 中按预留 `id` 登记：
   - 策略与数据：`coverage`（双池数据覆盖）、`factor`（Rank IC／五分组）
   - 产品分析：`attribution`（归因与成本）、`fees`（费后净值）、`capacity`（容量曲线）
   - 每项可填 `id`、`src`（如 `assets/figures/coverage.png`）、`alt`、`caption`、`version` / `date`。
4. 在 `simulation` 中填写 HTTPS 公开雪球链接 `url`、建仓日期 `startDate`、截图日期 `captureDate`、策略名称 `strategy`、实际持仓口径 `holdingsNote`、审阅后截图相对路径 `image` 及可选 `log`（如 `data/simulation-log.csv`）。
5. 上线前按终版技术报告**逐项抽查**：网页首末日期、样本外起点、年化收益、最大回撤、区间超额与雪球实际权重，确认三端（网页、报告、PPT）口径一致。

### 3. 可审计字段映射表

| 来源文件 | 输入字段 | 网站 JSON 字段 / 展示说明 |
| --- | --- | --- |
| `nav.csv` | `date` | `dates[]`（`YYYY-MM-DD`，严格递增且唯一） |
| `nav.csv` | `baseline,research,benchmark` | `nav.baseline[]` / `nav.research[]` / `nav.benchmark[]`（正有限小数；累计收益 = 当日净值 ÷ 共同起始净值 − 1；回撤 = 当日净值 ÷ 截至当日峰值 − 1） |
| `metrics.csv` | `period,strategy` | `metrics.<period>.<strategy>`（至少含 `all`，策略固定 `baseline` / `research` / `benchmark`） |
| `metrics.csv` | `annual_return,annual_volatility,sharpe,max_drawdown,excess_return` | 小数导入，空值渲染为「—」；`max_drawdown ≤ 0`；`benchmark` 的 `excess_return` 留空 |
| `run-meta.json` | `universe,benchmark,benchmarkType,version,initialNav,startDate,endDate,oosStart,rebalance,cost,annualTradingDays,riskFreeRate,excessReturnNote,turnoverNote` | `meta.*`（渲染至回测口径栏与图表样本外竖线；`oosStart` 为空时不画样本外线） |
| `turnover.csv`（可选） | `date,baseline,research` | `turnover.*`（日期须在 `nav.csv` 内，非负小数；展示观察日均值汇总） |

---

## 四、GitHub Pages 部署说明（`main` 分支 `/docs`）

待小组提供最终 GitHub 仓库信息并确认所有允许公开的文件后，再配置远程并发布：

1. 将本仓库代码与审阅通过的 `docs/` 推送至 GitHub 仓库的 `main` 分支。
2. 打开仓库页面 **Settings → Pages**：
   - **Source**：选择 `Deploy from a branch`
   - **Branch**：选择 `main`，目录选择 `/docs`，点击 **Save**。
3. 等待 Actions 构建完成，项目站点地址形如：
   - 网站首页：`https://<账号>.github.io/<仓库>/`
   - 回测章节直达：`https://<账号>.github.io/<仓库>/#backtest`
   - 雪球模拟直达：`https://<账号>.github.io/<仓库>/#simulation`
4. 用无痕浏览器分别打开上述三个地址，确认相对路径下的本地 ECharts 脚本、CSS、配图与 JSON 均可正常加载，且雪球外链可公开访问。

---

## 五、PPT 路演课件接入方式

1. 建议在路演 PPT 中准备一张入口页或悬浮按钮，放入 `previews/` 中生成的 **16:9 网页预览截图**（若定稿前使用演示模式截图，务必保留画面上显眼的「演示数据」标记；正式答辩前替换为终版正式数据截图）。
2. 在 PowerPoint 中选中截图或「打开在线回测网站」按钮形状，点击 **插入 → 链接**（快捷键 `Ctrl + K`），粘贴发布后的 HTTPS 地址：
   - 通用入口：`https://<账号>.github.io/<仓库>/`
   - 直达回测互动图：`https://<账号>.github.io/<仓库>/#backtest`
   - 直达雪球模拟：`https://<账号>.github.io/<仓库>/#simulation`
3. 放映前提前测试网络与教室浏览器缩放比例（推荐 100%–110%），确认投影仪上轴标签、图例和负值标注清晰可辨。

---

## 六、隐私与大文件留存规范

- 公开仓库与网页仅保留组员姓名及**学号尾号后四位**；完整学号单独维护在课程提交的正式 PDF 报告封面与本地材料中。
- 现有约 **590 MB 的 Tushare 双股票池原始行情包**及未脱敏个人账号截图留在小组本地，严禁提交至公开 Git 仓库（已在 `.gitignore` 中屏蔽常见大包与本地输入目录）。

---

## 相关交付文档

- [成果盘点报告](project-status.md)
- [小组补件清单](files-to-prepare.md)
- [数据样表与字段规范](templates/README.md)
- [网页制作技能与官方文档](SKILLS.md)
