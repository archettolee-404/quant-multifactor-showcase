(() => {
  "use strict";

  const SERIES_COLORS = {
    baseline: "#0D9488",
    research: "#B47412",
    benchmark: "#566B82",
    oos: "#1E3A5F"
  };

  const POOL_LABELS = {
    hs300: "沪深 300",
    zz500: "中证 500"
  };

  const PERIOD_LABELS = {
    all: "全区间 (all)",
    validation: "验证期 (validation)",
    oos: "历史留后段 (oos)"
  };

  const DEFAULT_SITE = {
    title: "量化多因子策略研究",
    course: "量化交易技术理论与实践",
    description: "",
    strategyName: "",
    role: "",
    strategyNote: "",
    members: [
      { name: "", studentIdLast4: "" },
      { name: "", studentIdLast4: "" },
      { name: "", studentIdLast4: "" },
      { name: "", studentIdLast4: "" }
    ],
    runs: { hs300: null, zz500: null },
    figures: [],
    simulation: {
      url: "",
      startDate: "",
      captureDate: "",
      strategy: "",
      holdingsNote: "",
      image: "",
      imageAlt: "",
      log: ""
    },
    codeUrl: ""
  };

  const FIGURE_DEFAULTS = {
    coverage: {
      title: "双池数据覆盖",
      placeholderCaption: "预留图位：展示沪深 300 与中证 500 的原始样本数、可交易有效样本数、行业缺失比例与数据覆盖起止。",
      defaultAlt: "双股票池数据覆盖统计图（待导入）"
    },
    factor: {
      title: "Rank IC／五分组",
      placeholderCaption: "预留图位：展示终版因子的 Rank IC 时序及五分组单调性收益柱形图，标明预测期限、分组方向与版本。",
      defaultAlt: "因子 Rank IC 与五分组收益检验图（待导入）"
    },
    attribution: {
      title: "归因与成本",
      placeholderCaption: "预留图位：展示隔夜、盘中、交易费用、未覆盖与残差的可对账归因分解及同约束成本对比。",
      defaultAlt: "收益归因与交易成本对比图（待导入）"
    },
    fees: {
      title: "费后净值",
      placeholderCaption: "预留图位：展示不同管理费与业绩报酬档位下的费后净值表现。",
      defaultAlt: "不同费率档位下的费后净值图（待导入）"
    },
    capacity: {
      title: "容量曲线",
      placeholderCaption: "预留图位：展示不同资金规模与市场流动性参与率假设下的策略容量曲线。",
      defaultAlt: "策略资金容量与流动性冲击曲线图（待导入）"
    }
  };

  const MEMBER_PLACEHOLDERS = ["组员一", "组员二", "组员三", "组员四"];

  const state = {
    site: DEFAULT_SITE,
    activePool: "hs300",
    activeMetric: "return", // "return" | "drawdown"
    demoMode: false,
    reducedMotion: false,
    pools: {
      hs300: { status: "pending", path: null, data: null, error: null },
      zz500: { status: "pending", path: null, data: null, error: null }
    },
    demoCache: null,
    activePeriod: "all",
    zoomStart: 0,
    zoomEnd: 100,
    playback: {
      playing: false,
      timerId: null,
      index: 0, // 展示到第 index 个点（1..N）
      speed: 2
    },
    chart: null,
    showAllTableRows: false
  };

  /* ==================== 工具与安全校验 ==================== */

  function isSafeRelativePath(path) {
    if (typeof path !== "string") return false;
    const trimmed = path.trim();
    if (!trimmed) return false;
    if (/^(https?:|javascript:|data:|file:|\/\/)/i.test(trimmed)) return false;
    if (trimmed.startsWith("/") || trimmed.startsWith("\\")) return false;
    const normalized = trimmed.replace(/\\/g, "/");
    if (normalized.split("/").includes("..")) return false;
    return true;
  }

  function toRelativeUrl(path) {
    const clean = path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    return "./" + clean;
  }

  function isSafeHttpsUrl(url) {
    if (typeof url !== "string" || !url.trim()) return false;
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  function sanitizeLast4(val) {
    if (val === null || val === undefined) return "";
    const digits = String(val).trim();
    if (!digits) return "";
    // 公开页面仅展示末四位（含前导零），避免误填全号泄露
    const onlyDigits = digits.replace(/\D/g, "");
    if (!onlyDigits) return "";
    return onlyDigits.slice(-4);
  }

  function isFiniteNum(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  function fmtPctNumber(v) {
    return (Math.abs(v) * 100).toFixed(2) + "%";
  }

  function formatMetricDisplay(value, kind) {
    if (!isFiniteNum(value)) {
      return { text: "—", cls: "val-muted" };
    }
    if (kind === "drawdown") {
      if (value < 0) {
        return { text: `回撤 −${fmtPctNumber(value)}`, cls: "val-neg" };
      }
      return { text: `回撤 0.00%`, cls: "val-neutral" };
    }
    if (kind === "return") {
      if (value < 0) {
        return { text: `负收益 −${fmtPctNumber(value)}`, cls: "val-neg" };
      }
      if (value > 0) {
        return { text: `+${fmtPctNumber(value)}`, cls: "val-pos" };
      }
      return { text: "0.00%", cls: "val-neutral" };
    }
    if (kind === "excess") {
      if (value < 0) {
        return { text: `负超额 −${fmtPctNumber(value)}`, cls: "val-neg" };
      }
      if (value > 0) {
        return { text: `超额 +${fmtPctNumber(value)}`, cls: "val-pos" };
      }
      return { text: "0.00%", cls: "val-neutral" };
    }
    if (kind === "volatility") {
      return { text: `${(value * 100).toFixed(2)}%`, cls: "val-neutral" };
    }
    if (kind === "sharpe") {
      if (value < 0) {
        return { text: `负夏普 −${Math.abs(value).toFixed(2)}`, cls: "val-neg" };
      }
      return { text: value.toFixed(2), cls: value > 0 ? "val-pos" : "val-neutral" };
    }
    return { text: String(value), cls: "val-neutral" };
  }

  function formatSeriesPointValue(value, metric) {
    if (!isFiniteNum(value)) return "—";
    if (metric === "drawdown") {
      if (value < 0) return `回撤 −${fmtPctNumber(value)}`;
      return "回撤 0.00%";
    }
    if (value < 0) return `亏损 −${fmtPctNumber(value)}`;
    if (value > 0) return `+${fmtPctNumber(value)}`;
    return "0.00%";
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showSiteAlert(message) {
    const el = document.getElementById("site-config-alert");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  /* ==================== 回测数据计算与校验 ==================== */

  function computeDerivedSeries(raw) {
    const dates = raw.dates;
    const nav = raw.nav;
    const initialNav = isFiniteNum(raw.meta && raw.meta.initialNav) && raw.meta.initialNav > 0
      ? raw.meta.initialNav
      : nav.baseline[0];

    const seriesKeys = ["baseline", "research", "benchmark"];
    const cumReturn = {};
    const drawdown = {};

    for (const key of seriesKeys) {
      const arr = nav[key];
      const retArr = new Array(arr.length);
      const ddArr = new Array(arr.length);
      let peak = initialNav;
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        retArr[i] = v / initialNav - 1;
        if (v > peak) peak = v;
        ddArr[i] = v / peak - 1;
      }
      cumReturn[key] = retArr;
      drawdown[key] = ddArr;
    }

    // 计算固定纵轴范围（播放期间保持稳定）
    const calcBounds = (dict, isDD) => {
      let minV = Infinity;
      let maxV = -Infinity;
      for (const key of seriesKeys) {
        const arr = dict[key];
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] < minV) minV = arr[i];
          if (arr[i] > maxV) maxV = arr[i];
        }
      }
      if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
        return isDD ? { min: -0.2, max: 0 } : { min: -0.1, max: 0.1 };
      }
      if (isDD) {
        const paddedMin = Math.min(-0.02, Math.floor((minV * 1.12) * 100) / 100);
        return { min: paddedMin, max: 0 };
      }
      const span = Math.max(maxV - minV, 0.04);
      const pad = span * 0.1;
      return {
        min: Math.floor((minV - pad) * 100) / 100,
        max: Math.ceil((maxV + pad) * 100) / 100
      };
    };

    return {
      ...raw,
      initialNav,
      cumReturn,
      drawdown,
      bounds: {
        return: calcBounds(cumReturn, false),
        drawdown: calcBounds(drawdown, true)
      }
    };
  }

  function validateRunPayload(raw) {
    if (!raw || typeof raw !== "object") {
      return "JSON 根节点必须是对象。";
    }
    if (!Array.isArray(raw.dates) || raw.dates.length < 2) {
      return "dates 字段缺失或交易日数量不足（至少需要 2 个交易日）。";
    }
    if (!raw.nav || typeof raw.nav !== "object") {
      return "缺少 nav 净值对象。";
    }
    const len = raw.dates.length;
    for (const key of ["baseline", "research", "benchmark"]) {
      const arr = raw.nav[key];
      if (!Array.isArray(arr) || arr.length !== len) {
        return `nav.${key} 缺失或长度与 dates 不一致。`;
      }
      for (let i = 0; i < len; i++) {
        if (!isFiniteNum(arr[i]) || arr[i] <= 0) {
          return `nav.${key} 在第 ${i + 1} 行包含非正或非有限数值。`;
        }
      }
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    for (let i = 0; i < len; i++) {
      const d = raw.dates[i];
      if (typeof d !== "string" || !dateRe.test(d)) {
        return `dates 第 ${i + 1} 项日期格式非法（应为 YYYY-MM-DD）。`;
      }
      if (i > 0 && d <= raw.dates[i - 1]) {
        return `dates 在第 ${i + 1} 项未严格递增或存在重复日期（${d}）。`;
      }
    }
    if (!raw.meta || typeof raw.meta !== "object") {
      return "缺少 meta 元数据对象。";
    }
    if (!raw.metrics || typeof raw.metrics !== "object" || Object.keys(raw.metrics).length === 0) {
      return "缺少 metrics 指标表对象。";
    }
    return null;
  }

  /* ==================== 本地演示数据生成器（仅主动点击时生成） ==================== */

  function createSeededRandom(seed) {
    let s = seed >>> 0;
    return () => {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function generateTradingDates(count, startYear) {
    const dates = [];
    const cur = new Date(Date.UTC(startYear, 0, 2));
    while (dates.length < count) {
      const day = cur.getUTCDay();
      if (day !== 0 && day !== 6) {
        const y = cur.getUTCFullYear();
        const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
        const d = String(cur.getUTCDate()).padStart(2, "0");
        dates.push(`${y}-${m}-${d}`);
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
  }

  function computeMetricsFromNav(navArr, benchArr, tradingDays, rf) {
    const n = navArr.length;
    const rets = [];
    let peak = navArr[0];
    let maxDD = 0;
    for (let i = 0; i < n; i++) {
      if (navArr[i] > peak) peak = navArr[i];
      const dd = navArr[i] / peak - 1;
      if (dd < maxDD) maxDD = dd;
      if (i > 0) rets.push(navArr[i] / navArr[i - 1] - 1);
    }
    const years = Math.max((n - 1) / tradingDays, 1 / tradingDays);
    const totalRet = navArr[n - 1] / navArr[0] - 1;
    const annRet = Math.pow(navArr[n - 1] / navArr[0], 1 / years) - 1;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(rets.length - 1, 1);
    const annVol = Math.sqrt(variance) * Math.sqrt(tradingDays);
    const sharpe = annVol > 0 ? (annRet - rf) / annVol : null;
    const benchTotal = benchArr ? (benchArr[n - 1] / benchArr[0] - 1) : null;
    const excess = benchArr ? (totalRet - benchTotal) : null;
    return {
      annual_return: Number(annRet.toFixed(6)),
      annual_volatility: Number(annVol.toFixed(6)),
      sharpe: sharpe === null ? null : Number(sharpe.toFixed(4)),
      max_drawdown: Number(maxDD.toFixed(6)),
      excess_return: excess === null ? null : Number(excess.toFixed(6))
    };
  }

  function buildDemoPool(poolKey) {
    const isHS = poolKey === "hs300";
    const rand = createSeededRandom(isHS ? 20260300 : 20260500);
    const count = 240; // 约一年交易日，流畅演示播放与缩放
    const dates = generateTradingDates(count, 2025);
    const oosIdx = 160;

    const baseline = [1.0];
    const research = [1.0];
    const benchmark = [1.0];

    for (let i = 1; i < count; i++) {
      // 加入典型回撤阶段（含真实负收益区间），演示回撤与负值显示
      const regime = (i > 70 && i < 115) ? -0.0024 : (i > 175 && i < 200 ? -0.0014 : 0.0005);
      const marketNoise = (rand() - 0.49) * (isHS ? 0.017 : 0.022);
      const benchStep = regime + marketNoise;
      const baseAlpha = (isHS ? 0.00035 : 0.00048) + (rand() - 0.5) * 0.0045;
      // Research 在某一段出现负超额，用于展示真实对照差异
      const resAlpha = (i > 165 && i < 210 ? -0.00035 : 0.00058) + (rand() - 0.5) * 0.0058;

      benchmark.push(Number((benchmark[i - 1] * (1 + benchStep)).toFixed(6)));
      baseline.push(Number((baseline[i - 1] * (1 + benchStep * 0.92 + baseAlpha)).toFixed(6)));
      research.push(Number((research[i - 1] * (1 + benchStep * 0.95 + resAlpha)).toFixed(6)));
    }

    const rf = 0.015;
    const td = 242;
    const buildPeriod = (start, end) => ({
      baseline: computeMetricsFromNav(baseline.slice(start, end), benchmark.slice(start, end), td, rf),
      research: computeMetricsFromNav(research.slice(start, end), benchmark.slice(start, end), td, rf),
      benchmark: computeMetricsFromNav(benchmark.slice(start, end), null, td, rf)
    });

    const raw = {
      schemaVersion: 1,
      isDemo: true,
      meta: {
        schemaVersion: 1,
        universe: isHS ? "沪深 300（演示合成）" : "中证 500（演示合成）",
        benchmark: isHS ? "沪深 300 指数（演示）" : "中证 500 指数（演示）",
        benchmarkType: "价格指数（演示口径）",
        version: "DEMO-SYNTHETIC",
        initialNav: 1.0,
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        oosStart: dates[oosIdx],
        rebalance: "月频调仓（演示）",
        cost: "双边千分之三（演示）",
        annualTradingDays: td,
        riskFreeRate: rf,
        excessReturnNote: "演示口径：区间累计收益 − 同期指数基准累计收益（非正式报告口径）",
        turnoverNote: "演示数据未含正式换手记录"
      },
      dates,
      nav: { baseline, research, benchmark },
      metrics: {
        all: buildPeriod(0, count),
        oos: buildPeriod(oosIdx, count)
      },
      turnover: null
    };
    return computeDerivedSeries(raw);
  }

  function ensureDemoCache() {
    if (!state.demoCache) {
      state.demoCache = {
        hs300: buildDemoPool("hs300"),
        zz500: buildDemoPool("zz500")
      };
    }
    return state.demoCache;
  }

  /* ==================== 数据加载 ==================== */

  async function loadSiteConfig() {
    try {
      const resp = await fetch("./data/site.json", { cache: "no-cache" });
      if (!resp.ok) {
        if (resp.status === 404) {
          showSiteAlert("未找到配置文件 docs/data/site.json（HTTP 404），当前使用内置默认占位配置展示。");
        } else {
          showSiteAlert(`读取 docs/data/site.json 失败（HTTP ${resp.status}），当前使用内置默认占位配置展示。`);
        }
        state.site = { ...DEFAULT_SITE };
        return;
      }
      const parsed = await resp.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        showSiteAlert("docs/data/site.json 格式错误（根节点必须为 JSON 对象），已回退到默认占位配置。");
        state.site = { ...DEFAULT_SITE };
        return;
      }
      state.site = {
        ...DEFAULT_SITE,
        ...parsed,
        runs: { ...DEFAULT_SITE.runs, ...(parsed.runs || {}) },
        simulation: { ...DEFAULT_SITE.simulation, ...(parsed.simulation || {}) },
        figures: Array.isArray(parsed.figures) ? parsed.figures : [],
        members: Array.isArray(parsed.members) ? parsed.members : DEFAULT_SITE.members
      };
    } catch (err) {
      showSiteAlert(`解析 docs/data/site.json 失败（格式错误或无法访问：${err.message}），已回退到默认占位配置。`);
      state.site = { ...DEFAULT_SITE };
    }
  }

  async function loadPoolRun(poolKey) {
    const rawPath = state.site.runs ? state.site.runs[poolKey] : null;
    if (!rawPath || typeof rawPath !== "string" || !rawPath.trim()) {
      state.pools[poolKey] = { status: "pending", path: null, data: null, error: null };
      return;
    }
    if (!isSafeRelativePath(rawPath)) {
      state.pools[poolKey] = {
        status: "invalid",
        path: rawPath,
        data: null,
        error: `runs.${poolKey} 必须为本站相对静态路径，当前值不被允许：${rawPath}`
      };
      return;
    }

    const relUrl = toRelativeUrl(rawPath);
    try {
      const resp = await fetch(relUrl, { cache: "no-cache" });
      if (!resp.ok) {
        state.pools[poolKey] = {
          status: "missing",
          path: rawPath,
          data: null,
          error: `无法加载数据文件 ${rawPath}（HTTP ${resp.status}）。请确认已运行导入脚本并将输出放入 docs/data/。`
        };
        return;
      }
      let jsonData;
      try {
        jsonData = await resp.json();
      } catch (parseErr) {
        state.pools[poolKey] = {
          status: "invalid",
          path: rawPath,
          data: null,
          error: `文件 ${rawPath} 不是有效的 JSON 格式：${parseErr.message}`
        };
        return;
      }
      const validationError = validateRunPayload(jsonData);
      if (validationError) {
        state.pools[poolKey] = {
          status: "invalid",
          path: rawPath,
          data: null,
          error: `文件 ${rawPath} 校验未通过：${validationError}`
        };
        return;
      }
      state.pools[poolKey] = {
        status: "ready",
        path: rawPath,
        data: computeDerivedSeries(jsonData),
        error: null
      };
    } catch (netErr) {
      state.pools[poolKey] = {
        status: "missing",
        path: rawPath,
        data: null,
        error: `请求 ${rawPath} 时发生异常（${netErr.message}）。请通过本地 HTTP 服务或 GitHub Pages 访问页面。`
      };
    }
  }

  /* ==================== CSV 解析（雪球调仓日志） ==================== */

  function parseCsvText(text) {
    const clean = text.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (inQuotes) {
        if (ch === '"') {
          if (clean[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field.trim());
        field = "";
      } else if (ch === "\n") {
        row.push(field.trim());
        if (row.some((cell) => cell !== "")) rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") {
        field += ch;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
    }
    return rows;
  }

  async function loadSimulationLog() {
    const sim = state.site.simulation || {};
    const statusBadge = document.getElementById("sim-log-status");
    const diagEl = document.getElementById("sim-log-diagnostic");
    const tbody = document.getElementById("sim-log-body");

    diagEl.hidden = true;
    diagEl.textContent = "";

    const logPath = (sim.log || "").trim();
    if (!logPath) {
      statusBadge.textContent = "调仓记录待补";
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">暂无已审阅调仓记录，配置 simulation-log.csv 后自动渲染。</td></tr>';
      return;
    }

    if (!isSafeRelativePath(logPath)) {
      statusBadge.textContent = "路径无效";
      diagEl.textContent = `调仓记录路径必须为本站相对静态路径，当前值被拒绝：${logPath}`;
      diagEl.hidden = false;
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">请修正 site.json 中的 simulation.log 相对路径。</td></tr>';
      return;
    }

    try {
      const resp = await fetch(toRelativeUrl(logPath), { cache: "no-cache" });
      if (!resp.ok) {
        statusBadge.textContent = "文件丢失";
        diagEl.textContent = `未找到调仓记录文件 ${logPath}（HTTP ${resp.status}）。`;
        diagEl.hidden = false;
        tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">请确认已将审阅后的 simulation-log.csv 放入站点对应路径。</td></tr>';
        return;
      }
      const text = await resp.text();
      const rows = parseCsvText(text);
      if (rows.length === 0) {
        statusBadge.textContent = "格式错误";
        diagEl.textContent = `文件 ${logPath} 为空，缺少表头。`;
        diagEl.hidden = false;
        return;
      }

      const expected = ["date", "event", "target_count", "actual_count", "actual_weight_sum", "note"];
      const header = rows[0].map((h) => h.toLowerCase());
      const missingCols = expected.filter((col) => !header.includes(col));
      if (missingCols.length > 0) {
        statusBadge.textContent = "格式错误";
        diagEl.textContent = `文件 ${logPath} 缺少必需列：${missingCols.join(", ")}。`;
        diagEl.hidden = false;
        tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">请按 templates/simulation-log.csv 表头规范核对字段。</td></tr>';
        return;
      }

      const dataRows = rows.slice(1);
      if (dataRows.length === 0) {
        statusBadge.textContent = "暂无记录";
        tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">调仓表已配置但当前尚无调仓记录行。</td></tr>';
        return;
      }

      const idx = Object.fromEntries(expected.map((c) => [c, header.indexOf(c)]));
      statusBadge.textContent = `已加载 ${dataRows.length} 条记录`;
      tbody.innerHTML = dataRows.map((r) => {
        const weightRaw = r[idx.actual_weight_sum] || "";
        let weightDisp = "—";
        if (weightRaw !== "") {
          const num = Number(weightRaw);
          if (Number.isFinite(num)) {
            weightDisp = num <= 1.5 ? `${(num * 100).toFixed(2)}%` : `${num.toFixed(2)}%`;
          } else {
            weightDisp = escapeHtml(weightRaw);
          }
        }
        return `<tr>
          <td class="mono">${escapeHtml(r[idx.date] || "—")}</td>
          <td>${escapeHtml(r[idx.event] || "—")}</td>
          <td class="num-col mono">${escapeHtml(r[idx.target_count] || "—")}</td>
          <td class="num-col mono">${escapeHtml(r[idx.actual_count] || "—")}</td>
          <td class="num-col mono">${weightDisp}</td>
          <td>${escapeHtml(r[idx.note] || "—")}</td>
        </tr>`;
      }).join("");
    } catch (err) {
      statusBadge.textContent = "加载失败";
      diagEl.textContent = `读取调仓记录 ${logPath} 失败：${err.message}`;
      diagEl.hidden = false;
    }
  }

  /* ==================== 页面内容渲染 ==================== */

  function renderSiteHeaderAndHero() {
    const site = state.site;
    const title = (site.title || "").trim() || DEFAULT_SITE.title;
    const course = (site.course || "").trim() || DEFAULT_SITE.course;
    const desc = (site.description || "").trim();

    document.title = `${title} · ${course}`;
    document.getElementById("nav-title").textContent = title;
    document.getElementById("nav-course").textContent = course;
    document.getElementById("hero-course").textContent = course;
    document.getElementById("hero-title").textContent = title;
    document.getElementById("footer-title").textContent = `${title} · ${course}`;

    if (desc) {
      document.getElementById("hero-description").textContent = desc;
    }

    // 4 个成员位置始终保留
    const membersList = document.getElementById("members-list");
    const rawMembers = Array.isArray(site.members) ? site.members : [];
    const cardsHtml = [];
    for (let i = 0; i < 4; i++) {
      const m = rawMembers[i] || {};
      const name = (m.name || "").trim() || MEMBER_PLACEHOLDERS[i];
      const last4 = sanitizeLast4(m.studentIdLast4);
      const idText = last4 ? `学号尾号 ${last4}` : "学号待补";
      cardsHtml.push(`
        <li class="member-card">
          <span class="member-index">0${i + 1}</span>
          <span class="member-name">${escapeHtml(name)}</span>
          <span class="member-id mono">${escapeHtml(idText)}</span>
        </li>
      `);
    }
    membersList.innerHTML = cardsHtml.join("");

    // 策略与数据段落
    const roleBadge = document.getElementById("strategy-role-badge");
    const nameEl = document.getElementById("strategy-name-text");
    const noteEl = document.getElementById("strategy-note-text");

    const role = (site.role || "").trim();
    const strategyName = (site.strategyName || "").trim();
    const strategyNote = (site.strategyNote || "").trim();

    roleBadge.textContent = role || "角色定位待补";
    if (strategyName) {
      nameEl.textContent = strategyName;
      nameEl.classList.remove("is-placeholder");
    } else {
      nameEl.textContent = "待小组确认终版配置后填入";
      nameEl.classList.add("is-placeholder");
    }
    if (strategyNote) {
      noteEl.textContent = strategyNote;
      noteEl.classList.remove("is-placeholder");
    } else {
      noteEl.textContent = "终版因子名称、方向、权重及样本划分以小组确认后的 site.json 为准，未冻结前不展示历史草稿参数。";
      noteEl.classList.add("is-placeholder");
    }

    // 页脚代码仓库链接（仅接受 HTTPS）
    const codeSlot = document.getElementById("footer-code-slot");
    const codeUrl = (site.codeUrl || "").trim();
    if (codeUrl) {
      if (isSafeHttpsUrl(codeUrl)) {
        codeSlot.innerHTML = `<a href="${escapeHtml(codeUrl)}" target="_blank" rel="noopener noreferrer">可复现代码仓库 ↗</a>`;
      } else {
        codeSlot.textContent = "代码仓库链接须使用 HTTPS 协议";
      }
    } else {
      codeSlot.textContent = "代码仓库链接待补";
    }
  }

  function renderStatusBadges() {
    const updateChip = (el, tabEl, poolKey) => {
      const p = state.pools[poolKey];
      el.classList.remove("status-pending", "status-ready", "status-error");
      if (p.status === "ready") {
        const ver = (p.data.meta && p.data.meta.version) ? ` · ${p.data.meta.version}` : "";
        el.textContent = `已导入${ver}`;
        el.classList.add("status-ready");
        tabEl.textContent = "已导入";
      } else if (p.status === "missing") {
        el.textContent = "文件丢失";
        el.classList.add("status-error");
        tabEl.textContent = "文件丢失";
      } else if (p.status === "invalid") {
        el.textContent = "格式错误";
        el.classList.add("status-error");
        tabEl.textContent = "格式错误";
      } else {
        el.textContent = "待导入";
        el.classList.add("status-pending");
        tabEl.textContent = state.demoMode ? "演示" : "待导入";
      }
      if (state.demoMode) {
        tabEl.textContent = "演示数据";
      }
    };

    updateChip(
      document.getElementById("status-hs300"),
      document.getElementById("tab-state-hs300"),
      "hs300"
    );
    updateChip(
      document.getElementById("status-zz500"),
      document.getElementById("tab-state-zz500"),
      "zz500"
    );

    const sim = state.site.simulation || {};
    const simFilled = Boolean(
      (sim.url && sim.url.trim()) ||
      (sim.image && sim.image.trim()) ||
      (sim.startDate && sim.startDate.trim()) ||
      (sim.captureDate && sim.captureDate.trim())
    );
    const simHeroPill = document.getElementById("status-sim");
    const simCardPill = document.getElementById("sim-card-status");
    for (const pill of [simHeroPill, simCardPill]) {
      pill.classList.remove("status-pending", "status-ready");
      if (simFilled) {
        pill.textContent = sim.captureDate ? `更新至 ${sim.captureDate}` : "已配置";
        pill.classList.add("status-ready");
      } else {
        pill.textContent = "待补充";
        pill.classList.add("status-pending");
      }
    }
  }

  /* ==================== 图位渲染（含稳定加载失败回退） ==================== */

  function renderFigureSlot(container, spec) {
    const title = spec.title || "研究配图";
    const metaText = spec.metaText || "版本 / 日期待补";
    const caption = spec.caption || "";
    const alt = spec.alt || title;
    const src = (spec.src || "").trim();

    container.innerHTML = "";

    const head = document.createElement("div");
    head.className = "figure-head";
    head.innerHTML = `<h3 class="figure-title">${escapeHtml(title)}</h3><span class="figure-meta mono">${escapeHtml(metaText)}</span>`;
    container.appendChild(head);

    const stage = document.createElement("div");
    stage.className = "figure-stage";

    const createFallback = (isError, tag, heading, desc) => {
      const box = document.createElement("div");
      box.className = isError ? "figure-fallback is-error" : "figure-fallback";
      box.setAttribute("role", isError ? "alert" : "status");
      box.innerHTML = `
        <span class="figure-fallback-tag">${escapeHtml(tag)}</span>
        <p class="figure-fallback-title">${escapeHtml(heading)}</p>
        <p class="figure-fallback-desc">${escapeHtml(desc)}</p>
      `;
      return box;
    };

    if (!src) {
      stage.appendChild(createFallback(
        false,
        "图位待导入",
        `${title}（待补充）`,
        spec.emptyHint || "将审阅后的 PNG/WebP 图片放入 docs/assets/figures/ 并在 site.json 中配置路径。"
      ));
    } else if (!isSafeRelativePath(src)) {
      stage.appendChild(createFallback(
        true,
        "路径被拦截",
        "仅允许加载本站静态相对路径图片",
        `已拒绝外部或非法路径：${src}`
      ));
    } else {
      const img = document.createElement("img");
      img.src = toRelativeUrl(src);
      img.alt = alt;
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => {
        stage.innerHTML = "";
        stage.appendChild(createFallback(
          true,
          "图片加载失败",
          `无法加载图片：${title}`,
          `路径 ${src} 不可用或文件缺失。替代说明：${alt}`
        ));
      });
      stage.appendChild(img);
    }

    container.appendChild(stage);

    const figcap = document.createElement("figcaption");
    figcap.className = "figure-caption-bar";
    figcap.innerHTML = `
      <div>${escapeHtml(caption || spec.emptyCaption || "")}</div>
      <p class="figure-alt-note">替代文本（Alt）：${escapeHtml(alt)}</p>
    `;
    container.appendChild(figcap);
  }

  function renderAllFigures() {
    const figures = Array.isArray(state.site.figures) ? state.site.figures : [];
    const byId = new Map();
    for (const item of figures) {
      if (item && typeof item.id === "string" && item.id.trim()) {
        byId.set(item.id.trim(), item);
      }
    }

    for (const [id, def] of Object.entries(FIGURE_DEFAULTS)) {
      const el = document.getElementById(`fig-slot-${id}`);
      if (!el) continue;
      const cfg = byId.get(id);
      const versionOrDate = cfg
        ? [cfg.version, cfg.date, cfg.meta].filter(Boolean).join(" · ") || (cfg.src ? "已配置" : "版本 / 日期待补")
        : "版本 / 日期待补";

      renderFigureSlot(el, {
        title: (cfg && cfg.title) ? cfg.title : def.title,
        metaText: versionOrDate,
        src: cfg ? (cfg.src || "") : "",
        alt: (cfg && cfg.alt) ? cfg.alt : def.defaultAlt,
        caption: (cfg && cfg.caption) ? cfg.caption : def.placeholderCaption,
        emptyHint: `图位 ID：${id}。请将审核定稿图片存入 docs/assets/figures/ 并在 site.json 的 figures 中登记。`
      });
    }
  }

  function renderSimulationSection() {
    const sim = state.site.simulation || {};

    const setField = (id, value, fallback) => {
      const el = document.getElementById(id);
      const trimmed = (value || "").trim();
      if (trimmed) {
        el.textContent = trimmed;
        el.classList.remove("is-placeholder");
      } else {
        el.textContent = fallback;
        el.classList.add("is-placeholder");
      }
    };

    setField("sim-strategy", sim.strategy, "待补充（需与终版持仓核对）");
    setField("sim-holdings-note", sim.holdingsNote, "待补充（披露实际持股数量、权重与跟踪关系）");
    setField("sim-start-date", sim.startDate, "待补充");
    setField("sim-capture-date", sim.captureDate, "待补充");

    const urlSlot = document.getElementById("sim-url-slot");
    const url = (sim.url || "").trim();
    if (!url) {
      urlSlot.innerHTML = '<span class="is-placeholder">公开链接待补（仅接受 HTTPS 地址）</span>';
    } else if (isSafeHttpsUrl(url)) {
      urlSlot.innerHTML = `<a class="external-link-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开雪球公开模拟组合 ↗</a>`;
    } else {
      urlSlot.innerHTML = '<span class="val-neg">外部链接无效：仅允许 HTTPS 公开地址</span>';
    }

    const simMeta = sim.captureDate
      ? `截图日期 ${sim.captureDate}`
      : (sim.startDate ? `建仓日期 ${sim.startDate}` : "截图日期待补");

    renderFigureSlot(document.getElementById("sim-image-slot"), {
      title: "雪球模拟净值截图",
      metaText: simMeta,
      src: sim.image || "",
      alt: (sim.imageAlt || "").trim() || "雪球模拟组合净值截图（待补充）",
      caption: (sim.imageCaption && sim.imageCaption.trim())
        ? sim.imageCaption.trim()
        : ((sim.image && sim.captureDate)
          ? `已审阅雪球模拟盘净值截图（建仓：${sim.startDate || "待补"}，截取：${sim.captureDate}），独立于历史回测曲线。`
          : "预留位置：展示小组已审阅并脱敏（裁去个人账号信息）的雪球模拟净值截图，保留时间轴与净值区间。"),
      emptyHint: "将已审阅截图存入 docs/assets/figures/ 并在 site.json 的 simulation.image 中配置相对路径。"
    });
  }

  /* ==================== 回测与风险交互逻辑 ==================== */

  function getActiveDataset() {
    if (state.demoMode) {
      return {
        status: "ready",
        data: ensureDemoCache()[state.activePool],
        error: null,
        path: null
      };
    }
    return state.pools[state.activePool];
  }

  function stopPlayback() {
    if (state.playback.timerId !== null) {
      window.clearInterval(state.playback.timerId);
      state.playback.timerId = null;
    }
    state.playback.playing = false;
    updatePlaybackButtons();
  }

  function updatePlaybackButtons() {
    const entry = getActiveDataset();
    const hasData = entry.status === "ready" && entry.data;
    const btnPlay = document.getElementById("btn-play");
    const btnPause = document.getElementById("btn-pause");
    const btnReplay = document.getElementById("btn-replay");
    const selectSpeed = document.getElementById("select-speed");
    const reducedNote = document.getElementById("reduced-motion-note");
    const readout = document.getElementById("playback-readout");

    reducedNote.hidden = !state.reducedMotion;

    if (!hasData) {
      btnPlay.disabled = true;
      btnPause.disabled = true;
      btnReplay.disabled = true;
      selectSpeed.disabled = true;
      readout.textContent = "— / —";
      return;
    }

    const total = entry.data.dates.length;
    const idx = Math.max(1, Math.min(state.playback.index || total, total));
    const currentDate = entry.data.dates[idx - 1];
    readout.textContent = `${currentDate} (${idx}/${total})`;

    if (state.reducedMotion) {
      btnPlay.disabled = true;
      btnPause.disabled = true;
      btnReplay.disabled = true;
      selectSpeed.disabled = true;
      return;
    }

    selectSpeed.disabled = false;
    btnPlay.disabled = state.playback.playing;
    btnPause.disabled = !state.playback.playing;
    btnReplay.disabled = false;
  }

  function updateZoomControlAvailability(enabled) {
    document.querySelectorAll("[data-zoom-preset]").forEach((b) => { b.disabled = !enabled; });
    for (const id of ["btn-zoom-in", "btn-zoom-out", "btn-pan-left", "btn-pan-right", "btn-zoom-reset", "zoom-start-range", "zoom-end-range"]) {
      const el = document.getElementById(id);
      if (el) el.disabled = !enabled;
    }
  }

  function syncZoomReadout(data) {
    const startSlider = document.getElementById("zoom-start-range");
    const endSlider = document.getElementById("zoom-end-range");
    const startDateEl = document.getElementById("zoom-start-date");
    const endDateEl = document.getElementById("zoom-end-date");

    if (!data) {
      startSlider.value = "0";
      endSlider.value = "100";
      startDateEl.textContent = "—";
      endDateEl.textContent = "—";
      return;
    }

    const s = Math.max(0, Math.min(95, Math.round(state.zoomStart)));
    const e = Math.max(s + 5, Math.min(100, Math.round(state.zoomEnd)));
    state.zoomStart = s;
    state.zoomEnd = e;

    startSlider.value = String(s);
    endSlider.value = String(e);

    const n = data.dates.length;
    const iStart = Math.min(n - 1, Math.floor((s / 100) * (n - 1)));
    const iEnd = Math.min(n - 1, Math.ceil((e / 100) * (n - 1)));
    startDateEl.textContent = data.dates[iStart];
    endDateEl.textContent = data.dates[iEnd];
  }

  function findOosMarkerDate(dates, oosStart) {
    if (!oosStart || typeof oosStart !== "string" || !oosStart.trim()) return null;
    const target = oosStart.trim();
    if (target < dates[0] || target > dates[dates.length - 1]) return null;
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] >= target) return dates[i];
    }
    return null;
  }

  function ensureChartInstance() {
    const host = document.getElementById("backtest-chart");
    if (!state.chart && typeof window.echarts !== "undefined") {
      state.chart = window.echarts.init(host, null, { renderer: "canvas" });
      state.chart.on("datazoom", (evt) => {
        const batch = evt.batch && evt.batch[0] ? evt.batch[0] : evt;
        if (typeof batch.start === "number" && typeof batch.end === "number") {
          state.zoomStart = batch.start;
          state.zoomEnd = batch.end;
          const entry = getActiveDataset();
          if (entry.status === "ready" && entry.data) {
            syncZoomReadout(entry.data);
            renderAccessibleDataTable(entry.data);
          }
        }
      });
    }
    return state.chart;
  }

  function renderChartOption(data, visibleCount) {
    const chart = ensureChartInstance();
    if (!chart) return;

    const metric = state.activeMetric;
    const isDD = metric === "drawdown";
    const seriesDict = isDD ? data.drawdown : data.cumReturn;
    const bounds = data.bounds[metric];
    const dates = data.dates;
    const benchLabel = (data.meta && data.meta.benchmark) ? `指数基准（${data.meta.benchmark}）` : "指数基准";

    document.getElementById("legend-label-benchmark").textContent = benchLabel;
    document.getElementById("col-bench-name").textContent = benchLabel;

    // 播放时保留完整横轴，未到达日期填 null，保证从左到右平稳推进且纵轴恒定
    const sliceOrPad = (arr) => {
      if (visibleCount >= arr.length) return arr;
      const out = new Array(arr.length);
      for (let i = 0; i < arr.length; i++) {
        out[i] = i < visibleCount ? arr[i] : null;
      }
      return out;
    };

    const oosDate = findOosMarkerDate(dates, data.meta && data.meta.oosStart);
    const markLine = oosDate ? {
      silent: true,
      symbol: ["none", "none"],
      lineStyle: { color: SERIES_COLORS.oos, width: 1.8, type: "dashed" },
      label: {
        formatter: `历史留后段起点\n${data.meta.oosStart}`,
        color: SERIES_COLORS.oos,
        fontSize: 12,
        fontWeight: 700,
        backgroundColor: "rgba(255,255,255,0.92)",
        padding: [4, 7],
        borderRadius: 4,
        borderColor: "#cbd5e1",
        borderWidth: 1,
        position: "insideEndTop"
      },
      data: [{ xAxis: oosDate }]
    } : undefined;

    const isNarrow = window.innerWidth < 640;

    const option = {
      animation: false,
      backgroundColor: "#ffffff",
      graphic: state.demoMode ? [{
        type: "text",
        right: 22,
        top: 14,
        silent: true,
        z: 10,
        style: {
          text: "演示数据 · 非正式回测",
          fill: "rgba(180, 83, 9, 0.42)",
          font: '700 15px "PingFang SC", "Microsoft YaHei", sans-serif'
        }
      }] : [],
      grid: {
        top: 28,
        right: isNarrow ? 16 : 28,
        bottom: 66,
        left: isNarrow ? 58 : 74
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(11, 24, 41, 0.95)",
        borderColor: "#334e6e",
        borderWidth: 1,
        textStyle: {
          color: "#f8fafc",
          fontSize: isNarrow ? 12 : 14,
          fontFamily: '"JetBrains Mono", "PingFang SC", "Microsoft YaHei", monospace'
        },
        formatter: (params) => {
          if (!Array.isArray(params) || params.length === 0) return "";
          const dateStr = params[0].axisValue || "";
          const oosTag = (data.meta && data.meta.oosStart && dateStr >= data.meta.oosStart)
            ? ' <span style="color:#5eead4;font-size:11px;">[历史留后段]</span>'
            : "";
          const demoTag = state.demoMode
            ? ' <span style="color:#fbbf24;font-size:11px;">[演示数据]</span>'
            : "";
          const lines = [`<div style="font-weight:700;margin-bottom:6px;">${escapeHtml(dateStr)}${oosTag}${demoTag}</div>`];
          for (const p of params) {
            if (p.data === null || p.data === undefined) continue;
            const formatted = formatSeriesPointValue(p.data, metric);
            const valColor = p.data < 0 ? "#fca5a5" : "#a7f3d0";
            lines.push(
              `<div style="display:flex;justify-content:space-between;gap:16px;margin:2px 0;">
                <span>${p.marker}${escapeHtml(p.seriesName)}</span>
                <strong style="color:${valColor};">${escapeHtml(formatted)}</strong>
              </div>`
            );
          }
          return lines.join("");
        }
      },
      xAxis: {
        type: "category",
        data: dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: "#94a3b8" } },
        axisLabel: {
          color: "#3f5166",
          fontSize: isNarrow ? 11 : 13,
          fontFamily: '"JetBrains Mono", Consolas, monospace',
          margin: 12
        },
        splitLine: { show: false }
      },
      yAxis: {
        type: "value",
        min: bounds.min,
        max: bounds.max,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#e8e4da", type: "dashed" } },
        axisLabel: {
          color: "#3f5166",
          fontSize: isNarrow ? 11 : 13,
          fontFamily: '"JetBrains Mono", Consolas, monospace',
          formatter: (val) => {
            const pct = (val * 100).toFixed(0);
            if (val < 0) return `−${Math.abs(Number(pct))}%`;
            if (val > 0) return `+${pct}%`;
            return "0%";
          }
        }
      },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          start: state.zoomStart,
          end: state.zoomEnd,
          filterMode: "none"
        },
        {
          type: "slider",
          xAxisIndex: 0,
          start: state.zoomStart,
          end: state.zoomEnd,
          height: 24,
          bottom: 10,
          borderColor: "#d6d0c4",
          backgroundColor: "#f3f0e8",
          fillerColor: "rgba(13, 148, 136, 0.16)",
          handleStyle: { color: "#0d9488", borderColor: "#0f766e" },
          textStyle: { color: "#3f5166", fontFamily: '"JetBrains Mono", monospace', fontSize: 11 },
          filterMode: "none"
        }
      ],
      series: [
        {
          name: "Baseline（策略组合）",
          type: "line",
          showSymbol: false,
          symbolSize: 6,
          data: sliceOrPad(seriesDict.baseline),
          itemStyle: { color: SERIES_COLORS.baseline },
          lineStyle: { color: SERIES_COLORS.baseline, width: 2.6, type: "solid" },
          areaStyle: isDD ? { color: "rgba(13, 148, 136, 0.08)" } : undefined,
          markLine,
          z: 4
        },
        {
          name: "Research（研究对照）",
          type: "line",
          showSymbol: false,
          symbolSize: 6,
          data: sliceOrPad(seriesDict.research),
          itemStyle: { color: SERIES_COLORS.research },
          lineStyle: { color: SERIES_COLORS.research, width: 2.3, type: "dashed" },
          z: 3
        },
        {
          name: benchLabel,
          type: "line",
          showSymbol: false,
          symbolSize: 6,
          data: sliceOrPad(seriesDict.benchmark),
          itemStyle: { color: SERIES_COLORS.benchmark },
          lineStyle: { color: SERIES_COLORS.benchmark, width: 2.2, type: "dotted" },
          z: 2
        }
      ]
    };

    chart.setOption(option, true);
  }

  function renderAccessibleDataTable(data) {
    const tbody = document.getElementById("chart-table-body");
    const countEl = document.getElementById("chart-table-count");

    if (!data) {
      countEl.textContent = "暂无数据";
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">待导入正式数据或开启演示模式后显示数值。</td></tr>';
      return;
    }

    const dates = data.dates;
    const n = dates.length;
    const iStart = Math.max(0, Math.floor((state.zoomStart / 100) * (n - 1)));
    const iEnd = Math.min(n - 1, Math.ceil((state.zoomEnd / 100) * (n - 1)));
    const spanCount = iEnd - iStart + 1;

    const indices = [];
    if (state.showAllTableRows || spanCount <= 28) {
      for (let i = iStart; i <= iEnd; i++) indices.push(i);
    } else {
      const targetPoints = 24;
      for (let k = 0; k < targetPoints; k++) {
        const idx = iStart + Math.round((k * (spanCount - 1)) / (targetPoints - 1));
        if (indices.length === 0 || indices[indices.length - 1] !== idx) {
          indices.push(idx);
        }
      }
    }

    const metric = state.activeMetric;
    const dict = metric === "drawdown" ? data.drawdown : data.cumReturn;
    const modeLabel = metric === "drawdown" ? "最大回撤" : "累计收益";
    const demoPrefix = state.demoMode ? "【演示数据】" : "";
    countEl.textContent = `${demoPrefix}${modeLabel} · 当前区间 ${dates[iStart]} 至 ${dates[iEnd]}（共 ${spanCount} 个交易日，展示 ${indices.length} 行）`;

    tbody.innerHTML = indices.map((i) => {
      const bVal = formatSeriesPointValue(dict.baseline[i], metric);
      const rVal = formatSeriesPointValue(dict.research[i], metric);
      const mVal = formatSeriesPointValue(dict.benchmark[i], metric);
      const clsFor = (v) => (v < 0 ? "val-neg" : (v > 0 ? "val-pos" : "val-neutral"));
      return `<tr>
        <td>${escapeHtml(dates[i])}</td>
        <td class="${clsFor(dict.baseline[i])}">${escapeHtml(bVal)}</td>
        <td class="${clsFor(dict.research[i])}">${escapeHtml(rVal)}</td>
        <td class="${clsFor(dict.benchmark[i])}">${escapeHtml(mVal)}</td>
      </tr>`;
    }).join("");
  }

  function renderRunMeta(data) {
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text || "—";
    };

    const verBadge = document.getElementById("meta-version-badge");
    if (!data || !data.meta) {
      verBadge.textContent = "版本待补";
      for (const id of [
        "meta-universe", "meta-benchmark", "meta-range", "meta-oos",
        "meta-rebalance", "meta-cost", "meta-annual", "meta-init-nav",
        "meta-excess-note", "meta-turnover-note"
      ]) {
        set(id, "—");
      }
      return;
    }

    const m = data.meta;
    verBadge.textContent = m.version ? `版本 ${m.version}` : "版本待补";
    set("meta-universe", m.universe || POOL_LABELS[state.activePool]);
    const benchJoined = [m.benchmark, m.benchmarkType].filter(Boolean).join(" · ");
    set("meta-benchmark", benchJoined || "—");
    const rangeStr = (m.startDate || data.dates[0]) + " 至 " + (m.endDate || data.dates[data.dates.length - 1]) + `（${data.dates.length} 交易日）`;
    set("meta-range", rangeStr);
    set("meta-oos", m.oosStart ? m.oosStart : "未单独标记");
    set("meta-rebalance", m.rebalance || "—");
    set("meta-cost", m.cost || "—");

    const tdStr = isFiniteNum(m.annualTradingDays) ? `${m.annualTradingDays} 日/年` : "—";
    const rfStr = isFiniteNum(m.riskFreeRate) ? `无风险 ${(m.riskFreeRate * 100).toFixed(2)}%` : "无风险 —";
    set("meta-annual", `${tdStr} / ${rfStr}`);
    set("meta-init-nav", isFiniteNum(data.initialNav) ? data.initialNav.toFixed(4) : "—");
    set("meta-excess-note", m.excessReturnNote || "—");

    let turnoverSummary = m.turnoverNote || "—";
    if (data.turnover && Array.isArray(data.turnover.dates) && data.turnover.dates.length > 0) {
      const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const bAvg = (avg(data.turnover.baseline) * 100).toFixed(2) + "%";
      const rAvg = (avg(data.turnover.research) * 100).toFixed(2) + "%";
      turnoverSummary = `已导入 ${data.turnover.dates.length} 次观察日（均值：Baseline ${bAvg} / Research ${rAvg}）` + (m.turnoverNote ? ` · ${m.turnoverNote}` : "");
    }
    set("meta-turnover-note", turnoverSummary);
  }

  function renderMetricsTable(data) {
    const tabsEl = document.getElementById("metrics-period-tabs");
    const tbody = document.getElementById("metrics-table-body");

    if (!data || !data.metrics || Object.keys(data.metrics).length === 0) {
      tabsEl.innerHTML = "";
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">待导入终版指标表（缺失项统一显示「—」）。</td></tr>';
      return;
    }

    const periodKeys = Object.keys(data.metrics);
    if (!periodKeys.includes(state.activePeriod)) {
      state.activePeriod = periodKeys.includes("all") ? "all" : periodKeys[0];
    }

    tabsEl.innerHTML = periodKeys.map((pk) => {
      const label = PERIOD_LABELS[pk] || pk;
      const active = pk === state.activePeriod;
      return `<button type="button" class="period-tab${active ? " is-active" : ""}" role="tab" aria-selected="${active}" data-period="${escapeHtml(pk)}">${escapeHtml(label)}</button>`;
    }).join("");

    tabsEl.querySelectorAll(".period-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activePeriod = btn.dataset.period;
        renderMetricsTable(data);
      });
    });

    const periodBlock = data.metrics[state.activePeriod] || {};
    const benchName = (data.meta && data.meta.benchmark) ? `指数基准（${data.meta.benchmark}）` : "指数基准";

    const rowsSpec = [
      { key: "baseline", label: "Baseline（策略组合）", swatch: "line-baseline" },
      { key: "research", label: "Research（研究对照）", swatch: "line-research" },
      { key: "benchmark", label: benchName, swatch: "line-benchmark" }
    ];

    tbody.innerHTML = rowsSpec.map((spec) => {
      const row = periodBlock[spec.key] || {};
      const annRet = formatMetricDisplay(row.annual_return, "return");
      const annVol = formatMetricDisplay(row.annual_volatility, "volatility");
      const sharpe = formatMetricDisplay(row.sharpe, "sharpe");
      const maxDD = formatMetricDisplay(row.max_drawdown, "drawdown");
      const excess = spec.key === "benchmark"
        ? { text: "—", cls: "val-muted" }
        : formatMetricDisplay(row.excess_return, "excess");

      return `<tr>
        <td><span class="series-cell"><span class="legend-line ${spec.swatch}" aria-hidden="true"></span><span>${escapeHtml(spec.label)}</span></span></td>
        <td class="num-col mono ${annRet.cls}">${escapeHtml(annRet.text)}</td>
        <td class="num-col mono ${annVol.cls}">${escapeHtml(annVol.text)}</td>
        <td class="num-col mono ${sharpe.cls}">${escapeHtml(sharpe.text)}</td>
        <td class="num-col mono ${maxDD.cls}">${escapeHtml(maxDD.text)}</td>
        <td class="num-col mono ${excess.cls}">${escapeHtml(excess.text)}</td>
      </tr>`;
    }).join("");
  }

  function renderBacktestSection() {
    stopPlayback();

    const demoTop = document.getElementById("demo-banner-top");
    const chartDemoTag = document.getElementById("chart-demo-tag");
    const metricsDemoTag = document.getElementById("metrics-demo-tag");
    const demoToggleBtn = document.getElementById("btn-demo-toggle");

    demoTop.hidden = !state.demoMode;
    chartDemoTag.hidden = !state.demoMode;
    metricsDemoTag.hidden = !state.demoMode;
    demoToggleBtn.setAttribute("aria-pressed", String(state.demoMode));
    demoToggleBtn.textContent = state.demoMode ? "退出演示" : "预览演示";

    // 更新股票池按钮激活状态
    for (const pool of ["hs300", "zz500"]) {
      const btn = document.getElementById(`tab-${pool}`);
      const active = pool === state.activePool;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    }

    // 更新口径按钮状态
    const isDD = state.activeMetric === "drawdown";
    document.getElementById("mode-return").classList.toggle("is-active", !isDD);
    document.getElementById("mode-return").setAttribute("aria-pressed", String(!isDD));
    document.getElementById("mode-drawdown").classList.toggle("is-active", isDD);
    document.getElementById("mode-drawdown").setAttribute("aria-pressed", String(isDD));

    const poolName = POOL_LABELS[state.activePool];
    const metricTitle = isDD ? "最大值到当日回撤曲线" : "累计收益曲线";
    document.getElementById("chart-title").textContent = `${poolName} · ${metricTitle}`;

    const overlay = document.getElementById("chart-state-overlay");
    const stateCard = overlay.querySelector(".state-card");
    const stateBadge = document.getElementById("state-badge");
    const stateTitle = document.getElementById("state-title");
    const stateDesc = document.getElementById("state-desc");
    const stateDetail = document.getElementById("state-detail");
    const stateActions = document.getElementById("state-actions");

    const entry = getActiveDataset();
    renderStatusBadges();

    if (entry.status !== "ready" || !entry.data) {
      overlay.hidden = false;
      stateCard.classList.toggle("is-error", entry.status === "missing" || entry.status === "invalid");
      stateActions.hidden = false;
      updateZoomControlAvailability(false);
      syncZoomReadout(null);
      updatePlaybackButtons();
      renderRunMeta(null);
      renderMetricsTable(null);
      renderAccessibleDataTable(null);

      if (state.chart) {
        state.chart.clear();
      }

      if (entry.status === "missing") {
        document.getElementById("chart-subtitle").textContent = `${poolName} 数据文件缺失，请核对构建输出路径。`;
        stateBadge.textContent = "文件丢失";
        stateTitle.textContent = `${poolName} 回测数据文件未找到`;
        stateDesc.textContent = "site.json 已配置该股票池路径，但浏览器未能读取到对应 JSON 文件。";
        stateDetail.textContent = entry.error || "";
        stateDetail.hidden = false;
      } else if (entry.status === "invalid") {
        document.getElementById("chart-subtitle").textContent = `${poolName} 数据文件格式校验失败。`;
        stateBadge.textContent = "格式错误";
        stateTitle.textContent = `${poolName} 回测数据格式不符合规范`;
        stateDesc.textContent = "请使用导入脚本重新校验 CSV 并生成标准 JSON 文件。";
        stateDetail.textContent = entry.error || "";
        stateDetail.hidden = false;
      } else {
        document.getElementById("chart-subtitle").textContent = `${poolName} 尚未导入终版数据；可切换另一股票池或点击「预览演示」。`;
        stateBadge.textContent = "待导入";
        stateTitle.textContent = `${poolName} 正式回测结果待导入`;
        stateDesc.textContent = "小组完成终版回测后，运行 scripts/import_backtest.py 生成 JSON 并写入 docs/data/site.json 即可自动渲染。";
        stateDetail.textContent = `待配置项：docs/data/site.json -> runs.${state.activePool}`;
        stateDetail.hidden = false;
      }
      return;
    }

    // 存在可用数据（正式结果或用户主动开启的演示数据）
    const data = entry.data;
    overlay.hidden = true;
    stateCard.classList.remove("is-error");

    const modeSuffix = state.demoMode
      ? "当前为本地合成演示数据（仅用于交互展示）"
      : `正式回测 · ${data.dates[0]} 至 ${data.dates[data.dates.length - 1]} · ${data.meta.benchmark || "指数基准"}`;
    document.getElementById("chart-subtitle").textContent = modeSuffix;

    state.zoomStart = 0;
    state.zoomEnd = 100;
    state.playback.index = data.dates.length;

    updateZoomControlAvailability(true);
    syncZoomReadout(data);
    renderChartOption(data, state.playback.index);
    updatePlaybackButtons();
    renderRunMeta(data);
    renderMetricsTable(data);
    renderAccessibleDataTable(data);
  }

  /* ==================== 播放与缩放控制 ==================== */

  function startPlayback(fromBeginning) {
    if (state.reducedMotion) return;
    const entry = getActiveDataset();
    if (entry.status !== "ready" || !entry.data) return;
    const data = entry.data;
    const total = data.dates.length;

    stopPlayback();

    if (fromBeginning || state.playback.index >= total || state.playback.index <= 1) {
      state.playback.index = 1;
    }

    state.playback.playing = true;
    renderChartOption(data, state.playback.index);
    updatePlaybackButtons();

    const stepSize = () => {
      const baseStep = Math.max(1, Math.round(total / 120));
      return Math.max(1, Math.round(baseStep * (state.playback.speed / 2)));
    };

    state.playback.timerId = window.setInterval(() => {
      const currentEntry = getActiveDataset();
      if (currentEntry.status !== "ready" || !currentEntry.data) {
        stopPlayback();
        return;
      }
      const d = currentEntry.data;
      state.playback.index = Math.min(d.dates.length, state.playback.index + stepSize());
      renderChartOption(d, state.playback.index);
      updatePlaybackButtons();
      if (state.playback.index >= d.dates.length) {
        stopPlayback();
      }
    }, 55);
  }

  function applyZoomRange(startPct, endPct) {
    const entry = getActiveDataset();
    if (entry.status !== "ready" || !entry.data) return;

    let s = Math.max(0, Math.min(95, startPct));
    let e = Math.max(5, Math.min(100, endPct));
    if (e - s < 5) {
      if (s + 5 <= 100) e = s + 5;
      else s = e - 5;
    }
    state.zoomStart = s;
    state.zoomEnd = e;
    syncZoomReadout(entry.data);
    if (state.chart) {
      state.chart.dispatchAction({ type: "dataZoom", start: s, end: e });
    }
    renderAccessibleDataTable(entry.data);
  }

  function applyZoomPreset(preset) {
    const entry = getActiveDataset();
    if (entry.status !== "ready" || !entry.data) return;
    const n = entry.data.dates.length;

    if (preset === "all") {
      applyZoomRange(0, 100);
    } else if (preset === "first-half") {
      applyZoomRange(0, 50);
    } else if (preset === "second-half") {
      applyZoomRange(50, 100);
    } else if (preset === "last-1y") {
      const days = Math.min(n, 242);
      const startPct = Math.max(0, Math.round(((n - days) / Math.max(n - 1, 1)) * 100));
      applyZoomRange(startPct, 100);
    }
  }

  /* ==================== 事件绑定与导航高亮 ==================== */

  function bindEvents() {
    // 演示切换
    const toggleDemo = (nextState) => {
      state.demoMode = typeof nextState === "boolean" ? nextState : !state.demoMode;
      renderBacktestSection();
    };
    document.getElementById("btn-demo-toggle").addEventListener("click", () => toggleDemo());
    document.getElementById("btn-demo-exit-inline").addEventListener("click", () => toggleDemo(false));
    document.getElementById("btn-empty-try-demo").addEventListener("click", () => toggleDemo(true));

    // 股票池切换
    document.getElementById("tab-hs300").addEventListener("click", () => {
      if (state.activePool !== "hs300") {
        state.activePool = "hs300";
        renderBacktestSection();
      }
    });
    document.getElementById("tab-zz500").addEventListener("click", () => {
      if (state.activePool !== "zz500") {
        state.activePool = "zz500";
        renderBacktestSection();
      }
    });

    // 累计收益 / 回撤切换
    document.getElementById("mode-return").addEventListener("click", () => {
      if (state.activeMetric !== "return") {
        state.activeMetric = "return";
        renderBacktestSection();
      }
    });
    document.getElementById("mode-drawdown").addEventListener("click", () => {
      if (state.activeMetric !== "drawdown") {
        state.activeMetric = "drawdown";
        renderBacktestSection();
      }
    });

    // 播放 / 暂停 / 重播 / 倍速
    document.getElementById("btn-play").addEventListener("click", () => startPlayback(false));
    document.getElementById("btn-pause").addEventListener("click", () => stopPlayback());
    document.getElementById("btn-replay").addEventListener("click", () => startPlayback(true));
    document.getElementById("select-speed").addEventListener("change", (e) => {
      state.playback.speed = Number(e.target.value) || 2;
    });

    // 键盘可操作的区间缩放按钮
    document.querySelectorAll("[data-zoom-preset]").forEach((btn) => {
      btn.addEventListener("click", () => applyZoomPreset(btn.dataset.zoomPreset));
    });
    document.getElementById("btn-zoom-in").addEventListener("click", () => {
      const span = state.zoomEnd - state.zoomStart;
      const step = Math.max(5, Math.round(span * 0.15));
      applyZoomRange(state.zoomStart + step / 2, state.zoomEnd - step / 2);
    });
    document.getElementById("btn-zoom-out").addEventListener("click", () => {
      const step = 12;
      applyZoomRange(state.zoomStart - step, state.zoomEnd + step);
    });
    document.getElementById("btn-pan-left").addEventListener("click", () => {
      const span = state.zoomEnd - state.zoomStart;
      const shift = Math.min(state.zoomStart, Math.max(5, Math.round(span * 0.2)));
      applyZoomRange(state.zoomStart - shift, state.zoomEnd - shift);
    });
    document.getElementById("btn-pan-right").addEventListener("click", () => {
      const span = state.zoomEnd - state.zoomStart;
      const shift = Math.min(100 - state.zoomEnd, Math.max(5, Math.round(span * 0.2)));
      applyZoomRange(state.zoomStart + shift, state.zoomEnd + shift);
    });
    document.getElementById("btn-zoom-reset").addEventListener("click", () => applyZoomRange(0, 100));

    // 双滑块键盘微调
    document.getElementById("zoom-start-range").addEventListener("input", (e) => {
      const val = Number(e.target.value);
      applyZoomRange(val, Math.max(state.zoomEnd, val + 5));
    });
    document.getElementById("zoom-end-range").addEventListener("input", (e) => {
      const val = Number(e.target.value);
      applyZoomRange(Math.min(state.zoomStart, val - 5), val);
    });

    // 数值表全量切换
    document.getElementById("chk-show-all-rows").addEventListener("change", (e) => {
      state.showAllTableRows = Boolean(e.target.checked);
      const entry = getActiveDataset();
      if (entry.status === "ready" && entry.data) {
        renderAccessibleDataTable(entry.data);
      }
    });

    // 减少动态效果系统监听
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    state.reducedMotion = mq.matches;
    const onMotionChange = (evt) => {
      state.reducedMotion = evt.matches;
      if (state.reducedMotion) {
        stopPlayback();
        const entry = getActiveDataset();
        if (entry.status === "ready" && entry.data) {
          state.playback.index = entry.data.dates.length;
          renderChartOption(entry.data, state.playback.index);
        }
      }
      updatePlaybackButtons();
    };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onMotionChange);
    }

    // 视口尺寸变化自适应图表
    window.addEventListener("resize", () => {
      if (state.chart) {
        state.chart.resize();
      }
    });

    // 滚动监听高亮顶部导航
    const sections = ["home", "method", "backtest", "product", "simulation"]
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    const navLinks = Array.from(document.querySelectorAll(".nav-link"));

    if ("IntersectionObserver" in window && sections.length > 0) {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            navLinks.forEach((link) => {
              link.classList.toggle("is-active", link.dataset.section === id);
            });
          }
        }
      }, { rootMargin: "-25% 0px -60% 0px", threshold: 0.01 });
      sections.forEach((sec) => io.observe(sec));
    }
  }

  /* ==================== 启动流程 ==================== */

  async function init() {
    bindEvents();
    await loadSiteConfig();
    renderSiteHeaderAndHero();
    renderAllFigures();
    renderSimulationSection();

    await Promise.all([
      loadPoolRun("hs300"),
      loadPoolRun("zz500"),
      loadSimulationLog()
    ]);

    // 单池已导入时自动优先展示已有结果的股票池，另一池保留待导入说明
    if (state.pools.hs300.status !== "ready" && state.pools.zz500.status === "ready") {
      state.activePool = "zz500";
    }

    renderBacktestSection();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
