# 网页数据样表

样表保留空值，供小组填写终版。CSV 使用 UTF-8，也支持 Excel 导出的带 BOM 的 UTF-8。样表只含字段与占位行。

## 公开配置

将 `site.example.json` 复制为 `site.json`。确认后填写 `members` 的四个姓名及 `studentIdLast4`。尾号保留四位字符串，含前导零。没有数据的股票池在 `runs` 中保持 `null`，正式导入后改为 `data/hs300.json`、`data/zz500.json`。路径相对站点根目录。

`figures` 各项使用 `id`、`src`、`alt`、`caption`。图位 ID 为 `coverage`、`factor`、`attribution`、`fees`、`capacity`。已审阅的图片放在站点 `assets/figures/` 下，相对路径填入 `src`。雪球单独配置链接、建仓日和截图日，示例日期保持空值。

## 回测数据

给 `hs300/` 和 `zz500/` 各准备下列文件，带 `.example` 的元数据模板填好后重命名。输入目录放在公开网站目录之外。

| 文件 | 字段 | 规则 |
| --- | --- | --- |
| `nav.csv` | `date,baseline,research,benchmark` | 每行一个交易日。日期用 `YYYY-MM-DD`、升序、唯一。三列均为正净值且使用同一归一化起点。旧版首列可能无列名，基准列可能叫 `hs300`。映射前确认基准名称与计算口径。 |
| `metrics.csv` | `period,strategy,annual_return,annual_volatility,sharpe,max_drawdown,excess_return` | 每个区间按 `baseline`、`research`、`benchmark` 各一行。区间可为 `all`、`validation`、`oos`，至少提供 `all`。指标空值显示「—」。最大回撤以非正小数保存，夏普为无量纲比值。指数基准的区间超额留空。 |
| `run-meta.json` | 见 `run-meta.example.json` | 填唯一结果版本、股票池、基准与其类型、共同初始净值、调仓、费用、样本外首日、区间超额定义及年化参数。日期和基准以最终报告为准。 |
| `turnover.csv` | `date,baseline,research` | 可选。每个换手观察日一行，日期须在净值表内，数值为非负小数。随元数据提供换手计算口径。 |

收益率、波动率、回撤、换手率与超额使用小数。例如 5% 写为 `0.05`，−12% 回撤写为 `-0.12`。区间超额字段按 `excessReturnNote` 中已确认的方法导入。测试时可由 Antigravity 生成独立的合成数据，页面持续标注「演示数据」。

## 雪球模拟

`simulation-log.csv` 记录日期、建仓／调仓、目标和实际持仓数量、实际权重合计及口径说明。事件对应实际记录。若只有截图，将对应日期和链接放入 `site.json`，调仓表留待补齐。
