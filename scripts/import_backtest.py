#!/usr/bin/env python3
"""
量化交易期末作业 · 回测 CSV 转 JSON 导入与校验工具 (Python 3 标准库)

功能：
  读取单个股票池目录（hs300/ 或 zz500/）下的：
    - nav.csv           (必需：date,baseline,research,benchmark)
    - metrics.csv       (必需：period,strategy,annual_return,annual_volatility,sharpe,max_drawdown,excess_return)
    - run-meta.json     (必需：见 templates/run-meta.example.json)
    - turnover.csv      (可选：date,baseline,research)

  支持 UTF-8 与带 BOM 的 UTF-8（Excel 导出兼容）。
  所有规则校验通过后才会原子写入 docs/data/<pool>.json；若校验失败，
  原有有效的输出文件保持不变，并在标准错误输出精确的文件名与行号。

样例命令：
  # 导入单个股票池
  python scripts/import_backtest.py --pool hs300 --input ./raw_runs/hs300 --output docs/data/hs300.json

  # 仅校验不写入（干跑）
  python scripts/import_backtest.py --pool hs300 --input ./raw_runs/hs300 --dry-run

  # 批量扫描输入根目录下的 hs300/ 与 zz500/ 子目录并输出到 docs/data/
  python scripts/import_backtest.py --input-root ./raw_runs --output-dir docs/data
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

NAV_REQUIRED_COLS = ("date", "baseline", "research", "benchmark")
METRICS_REQUIRED_COLS = (
    "period",
    "strategy",
    "annual_return",
    "annual_volatility",
    "sharpe",
    "max_drawdown",
    "excess_return",
)
TURNOVER_REQUIRED_COLS = ("date", "baseline", "research")
EXPECTED_STRATEGIES = ("baseline", "research", "benchmark")
ALLOWED_POOLS = ("hs300", "zz500")

# 可审计字段映射表（CSV/JSON 输入字段 -> 前端展示 JSON 字段）
FIELD_MAPPING = {
    "nav.csv": {
        "date": "dates[] (YYYY-MM-DD，严格递增且唯一)",
        "baseline": "nav.baseline[] (正有限浮点数)",
        "research": "nav.research[] (正有限浮点数)",
        "benchmark": "nav.benchmark[] (正有限浮点数)",
    },
    "metrics.csv": {
        "period": "metrics.<period> (至少包含 all，可选 validation / oos 等)",
        "strategy": "metrics.<period>.<strategy> (baseline / research / benchmark)",
        "annual_return": "年化收益（小数，可空）",
        "annual_volatility": "年化波动（非负小数，可空）",
        "sharpe": "夏普比率（无量纲，可空）",
        "max_drawdown": "最大回撤（非正小数，可空）",
        "excess_return": "区间超额（小数，基准留空）",
    },
    "run-meta.json": {
        "schemaVersion": "meta.schemaVersion (固定为 1)",
        "universe": "meta.universe (股票池名称)",
        "benchmark": "meta.benchmark (基准指数名称)",
        "benchmarkType": "meta.benchmarkType (价格指数 / 全收益指数)",
        "version": "meta.version (唯一结果版本号)",
        "initialNav": "meta.initialNav (共同初始净值，留空则取首日净值)",
        "startDate": "meta.startDate (回测起始日期，与 nav.csv 首日对齐)",
        "endDate": "meta.endDate (回测结束日期，与 nav.csv 末日对齐)",
        "oosStart": "meta.oosStart (样本外首日，未提供则为空字符串)",
        "rebalance": "meta.rebalance (调仓频率)",
        "cost": "meta.cost (交易成本口径)",
        "annualTradingDays": "meta.annualTradingDays (年化交易日数)",
        "riskFreeRate": "meta.riskFreeRate (无风险利率小数)",
        "excessReturnNote": "meta.excessReturnNote (区间超额定义说明)",
        "turnoverNote": "meta.turnoverNote (换手率计算口径说明)",
    },
    "turnover.csv (可选)": {
        "date": "turnover.dates[] (必须在 nav.csv 日期集合内)",
        "baseline": "turnover.baseline[] (非负小数)",
        "research": "turnover.research[] (非负小数)",
    },
}


class ValidationCollector:
    """收集所有带文件名与行号的校验错误。"""

    def __init__(self) -> None:
        self.errors: list[str] = []

    def add(self, filename: str, line: int | None, message: str) -> None:
        loc = f"{filename}:{line}" if line is not None else filename
        self.errors.append(f"[{loc}] {message}")

    def has_errors(self) -> bool:
        return len(self.errors) > 0


def parse_strict_date(raw: str) -> dt.date | None:
    s = raw.strip()
    if not DATE_RE.match(s):
        return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        return None


def parse_finite_float(raw: str) -> float | None:
    s = raw.strip()
    if not s:
        return None
    try:
        val = float(s)
    except ValueError:
        return None
    if not math.isfinite(val):
        return None
    return val


def read_csv_rows(path: Path, collector: ValidationCollector) -> tuple[list[str], list[tuple[int, dict[str, str]]]] | None:
    fname = path.name
    if not path.is_file():
        collector.add(fname, None, f"缺少必需文件：{path}")
        return None

    try:
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            try:
                raw_header = next(reader)
            except StopIteration:
                collector.add(fname, 1, "文件为空，缺少表头。")
                return None

            header = [col.strip() for col in raw_header]
            if any(h == "" for h in header):
                collector.add(fname, 1, f"表头包含空列名：{header}（旧版导出若首列无列名请显式补齐 date）。")
                return None

            if len(set(header)) != len(header):
                collector.add(fname, 1, f"表头存在重复列名：{header}")
                return None

            rows: list[tuple[int, dict[str, str]]] = []
            for line_no, raw_row in enumerate(reader, start=2):
                if not any(cell.strip() for cell in raw_row):
                    continue
                if len(raw_row) != len(header):
                    collector.add(
                        fname,
                        line_no,
                        f"列数与表头不一致（表头 {len(header)} 列，当前行 {len(raw_row)} 列）。",
                    )
                    continue
                row_dict = {header[i]: raw_row[i].strip() for i in range(len(header))}
                rows.append((line_no, row_dict))
            return header, rows
    except UnicodeDecodeError as exc:
        collector.add(fname, None, f"编码错误：文件必须为 UTF-8 或带 BOM 的 UTF-8（{exc}）。")
        return None
    except OSError as exc:
        collector.add(fname, None, f"无法读取文件：{exc}")
        return None


def load_and_validate_nav(
    path: Path, collector: ValidationCollector
) -> tuple[list[str], dict[str, list[float]]] | None:
    res = read_csv_rows(path, collector)
    if res is None:
        return None
    header, rows = res
    fname = path.name

    missing = [col for col in NAV_REQUIRED_COLS if col not in header]
    if missing:
        collector.add(
            fname,
            1,
            f"缺少必需列：{', '.join(missing)}（实际表头：{', '.join(header)}）。",
        )
        return None

    if len(rows) < 2:
        collector.add(fname, None, f"有效交易日记录不足（当前 {len(rows)} 行，至少需要 2 行）。")
        return None

    dates: list[str] = []
    nav_data: dict[str, list[float]] = {"baseline": [], "research": [], "benchmark": []}
    seen_dates: dict[str, int] = {}
    prev_date: dt.date | None = None
    prev_date_str: str | None = None

    for line_no, row in rows:
        raw_date = row["date"]
        parsed_date = parse_strict_date(raw_date)
        if parsed_date is None:
            collector.add(fname, line_no, f"日期格式非法 '{raw_date}'（必须为有效的 YYYY-MM-DD）。")
            continue

        if raw_date in seen_dates:
            collector.add(
                fname,
                line_no,
                f"重复日期 '{raw_date}'（首次出现在第 {seen_dates[raw_date]} 行）。",
            )
        else:
            seen_dates[raw_date] = line_no
            if prev_date is not None and parsed_date <= prev_date:
                collector.add(
                    fname,
                    line_no,
                    f"日期未严格递增：'{raw_date}' 不晚于上一行 '{prev_date_str}'。",
                )
            prev_date = parsed_date
            prev_date_str = raw_date

        row_ok = True
        parsed_vals: dict[str, float] = {}
        for col in ("baseline", "research", "benchmark"):
            raw_val = row[col]
            if raw_val == "":
                collector.add(fname, line_no, f"列 '{col}' 为空（日期 {raw_date} 三组净值必须对齐完整）。")
                row_ok = False
                continue
            val = parse_finite_float(raw_val)
            if val is None:
                collector.add(fname, line_no, f"列 '{col}' 不是有限数值：'{raw_val}'。")
                row_ok = False
                continue
            if val <= 0:
                collector.add(fname, line_no, f"列 '{col}' 净值必须为正数，当前为 {val}。")
                row_ok = False
                continue
            parsed_vals[col] = val

        if row_ok:
            dates.append(raw_date)
            for col in ("baseline", "research", "benchmark"):
                nav_data[col].append(parsed_vals[col])

    if collector.has_errors():
        return None
    return dates, nav_data


def load_and_validate_metrics(
    path: Path, collector: ValidationCollector
) -> dict[str, dict[str, dict[str, float | None]]] | None:
    res = read_csv_rows(path, collector)
    if res is None:
        return None
    header, rows = res
    fname = path.name

    missing = [col for col in METRICS_REQUIRED_COLS if col not in header]
    if missing:
        collector.add(
            fname,
            1,
            f"缺少必需列：{', '.join(missing)}（实际表头：{', '.join(header)}）。",
        )
        return None

    if not rows:
        collector.add(fname, None, "指标表不含任何数据行，至少需提供 all 区间。")
        return None

    metrics: dict[str, dict[str, dict[str, float | None]]] = {}
    seen_pairs: dict[tuple[str, str], int] = {}

    for line_no, row in rows:
        period = row["period"].strip()
        strategy = row["strategy"].strip().lower()

        if not period:
            collector.add(fname, line_no, "period 列不能为空。")
            continue
        if strategy not in EXPECTED_STRATEGIES:
            collector.add(
                fname,
                line_no,
                f"strategy 列值非法 '{row['strategy']}'（仅允许 baseline / research / benchmark）。",
            )
            continue

        pair = (period, strategy)
        if pair in seen_pairs:
            collector.add(
                fname,
                line_no,
                f"重复的 (period={period}, strategy={strategy}) 行（首次出现在第 {seen_pairs[pair]} 行）。",
            )
            continue
        seen_pairs[pair] = line_no

        parsed_metrics: dict[str, float | None] = {}
        for col in ("annual_return", "annual_volatility", "sharpe", "max_drawdown", "excess_return"):
            raw_v = row[col]
            if raw_v == "":
                parsed_metrics[col] = None
                continue
            v = parse_finite_float(raw_v)
            if v is None:
                collector.add(fname, line_no, f"列 '{col}' 不是有效有限数值：'{raw_v}'。")
                parsed_metrics[col] = None
                continue

            if col == "annual_volatility" and v < 0:
                collector.add(fname, line_no, f"列 'annual_volatility' 不能为负值（当前为 {v}）。")
            if col == "max_drawdown" and v > 0:
                collector.add(fname, line_no, f"列 'max_drawdown' 必须为非正小数（如 -0.12），当前为 {v}。")
            if col == "excess_return" and strategy == "benchmark":
                collector.add(fname, line_no, "指数基准（benchmark）行的 excess_return 列应留空。")
            parsed_metrics[col] = v

        metrics.setdefault(period, {})[strategy] = parsed_metrics

    if "all" not in metrics:
        collector.add(fname, None, "缺少必需的 'all'（全区间）绩效统计。")

    for period, block in metrics.items():
        missing_strats = [s for s in EXPECTED_STRATEGIES if s not in block]
        if missing_strats:
            collector.add(
                fname,
                None,
                f"区间 '{period}' 缺少策略行：{', '.join(missing_strats)}。",
            )

    if collector.has_errors():
        return None
    return metrics


def load_and_validate_meta(
    path: Path, dates: list[str] | None, nav_data: dict[str, list[float]] | None, collector: ValidationCollector
) -> dict[str, Any] | None:
    fname = path.name
    if not path.is_file():
        collector.add(fname, None, f"缺少必需文件：{path}")
        return None

    try:
        raw_text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as exc:
        collector.add(fname, None, f"编码错误：文件必须为 UTF-8（{exc}）。")
        return None
    except OSError as exc:
        collector.add(fname, None, f"无法读取文件：{exc}")
        return None

    try:
        meta = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        collector.add(fname, exc.lineno, f"JSON 语法错误：{exc.msg}（第 {exc.colno} 列）。")
        return None

    if not isinstance(meta, dict):
        collector.add(fname, 1, "run-meta.json 根节点必须为 JSON 对象。")
        return None

    schema_ver = meta.get("schemaVersion")
    if schema_ver != 1:
        collector.add(fname, None, f"schemaVersion 必须为 1，当前为 {schema_ver!r}。")

    for req_key in ("universe", "benchmark", "benchmarkType", "version"):
        val = meta.get(req_key)
        if not isinstance(val, str) or not val.strip():
            collector.add(fname, None, f"必填字段 '{req_key}' 缺失或为空。")

    init_nav = meta.get("initialNav")
    if init_nav is not None:
        if isinstance(init_nav, bool) or not isinstance(init_nav, (int, float)) or not math.isfinite(init_nav) or init_nav <= 0:
            collector.add(fname, None, f"initialNav 必须为正有限数值或 null，当前为 {init_nav!r}。")
    elif nav_data is not None:
        init_nav = nav_data["baseline"][0]

    for num_key, must_be_positive in (("annualTradingDays", True), ("riskFreeRate", False)):
        val = meta.get(num_key)
        if val is not None:
            if isinstance(val, bool) or not isinstance(val, (int, float)) or not math.isfinite(val):
                collector.add(fname, None, f"字段 '{num_key}' 必须为有限数值或 null，当前为 {val!r}。")
            elif must_be_positive and val <= 0:
                collector.add(fname, None, f"字段 '{num_key}' 必须为正数，当前为 {val!r}。")

    start_date = (meta.get("startDate") or "").strip() if isinstance(meta.get("startDate"), str) else ""
    end_date = (meta.get("endDate") or "").strip() if isinstance(meta.get("endDate"), str) else ""
    oos_start = (meta.get("oosStart") or "").strip() if isinstance(meta.get("oosStart"), str) else ""

    if start_date and parse_strict_date(start_date) is None:
        collector.add(fname, None, f"startDate 日期格式非法：'{start_date}'。")
    if end_date and parse_strict_date(end_date) is None:
        collector.add(fname, None, f"endDate 日期格式非法：'{end_date}'。")
    if oos_start and parse_strict_date(oos_start) is None:
        collector.add(fname, None, f"oosStart 日期格式非法：'{oos_start}'。")

    if dates:
        first_d, last_d = dates[0], dates[-1]
        if start_date and start_date != first_d:
            collector.add(fname, None, f"startDate ({start_date}) 与 nav.csv 首日 ({first_d}) 不一致。")
        if end_date and end_date != last_d:
            collector.add(fname, None, f"endDate ({end_date}) 与 nav.csv 末日 ({last_d}) 不一致。")
        if oos_start and parse_strict_date(oos_start) is not None:
            if oos_start < first_d or oos_start > last_d:
                collector.add(
                    fname,
                    None,
                    f"oosStart ({oos_start}) 超出 nav.csv 区间 [{first_d}, {last_d}]。",
                )
        if not start_date:
            start_date = first_d
        if not end_date:
            end_date = last_d

    if collector.has_errors():
        return None

    return {
        "schemaVersion": 1,
        "universe": meta["universe"].strip(),
        "benchmark": meta["benchmark"].strip(),
        "benchmarkType": meta["benchmarkType"].strip(),
        "version": meta["version"].strip(),
        "initialNav": float(init_nav) if init_nav is not None else None,
        "startDate": start_date,
        "endDate": end_date,
        "oosStart": oos_start,
        "rebalance": (meta.get("rebalance") or "").strip() if isinstance(meta.get("rebalance"), str) else "",
        "cost": (meta.get("cost") or "").strip() if isinstance(meta.get("cost"), str) else "",
        "annualTradingDays": meta.get("annualTradingDays"),
        "riskFreeRate": meta.get("riskFreeRate"),
        "excessReturnNote": (meta.get("excessReturnNote") or "").strip() if isinstance(meta.get("excessReturnNote"), str) else "",
        "turnoverNote": (meta.get("turnoverNote") or "").strip() if isinstance(meta.get("turnoverNote"), str) else "",
    }


def load_and_validate_turnover(
    path: Path, nav_date_set: set[str], collector: ValidationCollector
) -> dict[str, Any] | None:
    if not path.exists():
        return None

    res = read_csv_rows(path, collector)
    if res is None:
        return None
    header, rows = res
    fname = path.name

    missing = [col for col in TURNOVER_REQUIRED_COLS if col not in header]
    if missing:
        collector.add(
            fname,
            1,
            f"缺少必需列：{', '.join(missing)}（实际表头：{', '.join(header)}）。",
        )
        return None

    if not rows:
        return None

    t_dates: list[str] = []
    t_base: list[float] = []
    t_res: list[float] = []
    seen: dict[str, int] = {}
    prev_d: dt.date | None = None
    prev_s: str | None = None

    for line_no, row in rows:
        raw_d = row["date"]
        parsed_d = parse_strict_date(raw_d)
        if parsed_d is None:
            collector.add(fname, line_no, f"日期格式非法 '{raw_d}'（必须为 YYYY-MM-DD）。")
            continue
        if raw_d in seen:
            collector.add(fname, line_no, f"重复换手日期 '{raw_d}'（首次出现在第 {seen[raw_d]} 行）。")
            continue
        seen[raw_d] = line_no

        if prev_d is not None and parsed_d <= prev_d:
            collector.add(fname, line_no, f"换手日期未严格递增：'{raw_d}' 不晚于 '{prev_s}'。")
        prev_d = parsed_d
        prev_s = raw_d

        if raw_d not in nav_date_set:
            collector.add(fname, line_no, f"换手日期 '{raw_d}' 不在 nav.csv 交易日列表中。")

        vals: dict[str, float] = {}
        ok = True
        for col in ("baseline", "research"):
            raw_v = row[col]
            v = parse_finite_float(raw_v)
            if v is None:
                collector.add(fname, line_no, f"列 '{col}' 不是有限数值：'{raw_v}'。")
                ok = False
            elif v < 0:
                collector.add(fname, line_no, f"列 '{col}' 换手率必须为非负小数，当前为 {v}。")
                ok = False
            else:
                vals[col] = v

        if ok:
            t_dates.append(raw_d)
            t_base.append(vals["baseline"])
            t_res.append(vals["research"])

    if collector.has_errors():
        return None

    return {
        "dates": t_dates,
        "baseline": t_base,
        "research": t_res,
    }


def atomic_write_json(target: Path, payload: dict[str, Any]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=str(target.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp_path, target)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def import_single_pool(pool: str, input_dir: Path, output_path: Path | None, dry_run: bool = False) -> tuple[bool, list[str]]:
    collector = ValidationCollector()

    if not input_dir.is_dir():
        collector.add(str(input_dir), None, "输入目录不存在或不是文件夹。")
        return False, collector.errors

    nav_res = load_and_validate_nav(input_dir / "nav.csv", collector)
    dates = nav_res[0] if nav_res else None
    nav_data = nav_res[1] if nav_res else None

    metrics = load_and_validate_metrics(input_dir / "metrics.csv", collector)
    meta = load_and_validate_meta(input_dir / "run-meta.json", dates, nav_data, collector)

    turnover = None
    turnover_path = input_dir / "turnover.csv"
    if turnover_path.exists():
        turnover = load_and_validate_turnover(
            turnover_path, set(dates) if dates else set(), collector
        )

    if collector.has_errors() or dates is None or nav_data is None or metrics is None or meta is None:
        return False, collector.errors

    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "pool": pool,
        "meta": meta,
        "dates": dates,
        "nav": nav_data,
        "metrics": metrics,
        "turnover": turnover,
    }

    if not dry_run:
        assert output_path is not None
        atomic_write_json(output_path, payload)

    return True, []


def print_field_mapping() -> None:
    print(json.dumps(FIELD_MAPPING, ensure_ascii=False, indent=2))


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="将单池或双池回测 CSV 与 run-meta.json 校验并转换为静态网站可用的 JSON。"
    )
    parser.add_argument(
        "--pool",
        choices=ALLOWED_POOLS,
        help="单池模式：指定股票池代码（hs300 或 zz500）。需搭配 --input 使用。",
    )
    parser.add_argument(
        "--input",
        type=Path,
        help="单池模式：包含 nav.csv、metrics.csv、run-meta.json（及可选 turnover.csv）的输入目录。",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="单池模式：输出 JSON 路径（默认为 docs/data/<pool>.json）。",
    )
    parser.add_argument(
        "--input-root",
        type=Path,
        help="批量模式：扫描该目录下的 hs300/ 与 zz500/ 子目录，存在哪个池就导入哪个池。",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("docs/data"),
        help="批量模式输出目录（默认 docs/data）。",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅执行严格校验，不写入输出文件。",
    )
    parser.add_argument(
        "--show-mapping",
        action="store_true",
        help="打印可审计的输入/输出字段映射表并退出。",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.show_mapping:
        print_field_mapping()
        return 0

    tasks: list[tuple[str, Path, Path]] = []

    if args.input_root:
        if not args.input_root.is_dir():
            print(f"错误：批量输入根目录不存在：{args.input_root}", file=sys.stderr)
            return 2
        for pool in ALLOWED_POOLS:
            sub = args.input_root / pool
            if sub.is_dir():
                tasks.append((pool, sub, args.output_dir / f"{pool}.json"))
        if not tasks:
            print(
                f"错误：在 {args.input_root} 下未找到 hs300/ 或 zz500/ 子目录。",
                file=sys.stderr,
            )
            return 2
    elif args.pool and args.input:
        out = args.output if args.output else Path("docs/data") / f"{args.pool}.json"
        tasks.append((args.pool, args.input, out))
    else:
        parser.print_help(sys.stderr)
        return 2

    all_ok = True
    for pool, in_dir, out_path in tasks:
        ok, errors = import_single_pool(pool, in_dir, out_path, dry_run=args.dry_run)
        if ok:
            action = "校验通过（dry-run 未写入）" if args.dry_run else f"导入成功 -> {out_path}"
            print(f"[OK] {pool}: {action}")
        else:
            all_ok = False
            print(f"[FAIL] {pool} ({in_dir}) 共发现 {len(errors)} 处错误，已中止写入（保留原有输出文件）：", file=sys.stderr)
            for err in errors:
                print(f"  - {err}", file=sys.stderr)

    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
