// src/math/occr.ts
import {
    CurrentPosition,
    Loan,
    OCCRResult,
    OCCRSubscores,
    PortfolioSnapshot,
    Transaction,
  } from "../types.js";
  
  /* ------------------------------- helpers -------------------------------- */
  
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  
  /** logistic recency scaler in [0,1] using relative date in a window */
  function logisticRecencyFromDate(d: Date, minDate: Date, maxDate: Date) {
    const spanMs = maxDate.getTime() - minDate.getTime();
    if (spanMs <= 0) return 0.5;
    const x = (d.getTime() - minDate.getTime()) / spanMs; // 0..1
    const k = 0.5; // mid
    const slope = 10; // steeper emphasis on recent activity
    return 1 / (1 + Math.exp(-(x - k) * slope));
  }
  
  /** combined collateral risk r_{i,j} from weighted σ; default σ if unknown */
  function collateralRisk(collats: { amountUSD: number; sigma?: number }[] = []): number {
    if (collats.length === 0) return 0.5;
    const sigmas = collats.map((c) => Math.max(0, c.sigma ?? 0.6));
    const sigmaMax = Math.max(...sigmas, 1e-9);
    const totalC = collats.reduce((s, c) => s + Math.max(0, c.amountUSD), 0);
    if (totalC <= 0) return 0.5;
    const wsum = collats.reduce(
      (s, c, i) => s + Math.max(0, c.amountUSD) * (sigmas[i] / sigmaMax),
      0
    );
    return clamp01(wsum / totalC);
  }
  
  /* ------------------------ deterministic RNG for MC ----------------------- */
  
  /** Mulberry32 PRNG for reproducible paths */
  function rng(seed: number) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  
  /** Box–Muller using provided PRNG */
  function gaussianPRNG(next: () => number): number {
    let u = 0,
      v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
  
  /* ------------------------------ sub-scores ------------------------------- */
  
  /**
   * 3.1 Historical Credit Risk s_h
   * \hat s_h = (Σ w X) / (Σ w), with w = L * (1 - r) * p_exp * t
   * X = 1 if liquidated else 0
   */
  export function s_h(loansHistory?: Loan[]): number {
    const Ls = loansHistory ?? [];
    if (Ls.length === 0) return 0.0;
  
    const dates = Ls.map((l) => new Date(l.openedAt));
    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
  
    let num = 0,
      den = 0;
  
    for (const L of Ls) {
      const Lamt = Math.max(0, L.amountUSD);
      const r = collateralRisk(L.collaterals ?? []);
      const t = logisticRecencyFromDate(new Date(L.openedAt), minDate, maxDate);
      const pExposure =
        typeof (L as any).exposureProportion === "number"
          ? Math.max(0, (L as any).exposureProportion)
          : Math.max(0, L.liquidatedProportion ?? 1);
  
      const w = Lamt * (1 - r) * pExposure * t;
      den += w;
      if (L.liquidated) num += w;
    }
  
    if (den <= 0) return 0.0;
    return clamp01(num / den);
  }
  
  /**
   * 3.2 Current Credit Risk s_c
   * Monte Carlo P(LaR_total >= holdingsUSD) over a short horizon (default ~1 day).
   * Uses lognormal shock with annualized σ scaled by sqrt(dt).
   * Deterministic via seeded PRNG so same snapshot -> same score.
   */
  export function s_c(
    current?: CurrentPosition[],
    holdingsUSD: number = 0,
    paths = Number(process.env.OCCR_MC_PATHS ?? 2000)
  ): number {
    const positions = current ?? [];
    if (positions.length === 0) return 0.0;
    if (holdingsUSD < 0) holdingsUSD = 0;
  
    // 1 trading day horizon (tunable via env)
    const dtEnv = Number(process.env.OCCR_MC_DT_DAYS ?? 1) / 252;
    const dt = isFinite(dtEnv) && dtEnv > 0 ? dtEnv : 1 / 252;
  
    // seed based on snapshot to be reproducible
    const seedBase =
      Math.round(holdingsUSD) +
      positions.length * 1337 +
      positions.reduce(
        (s, p) => s + Math.round((p.debtUSD || 0) + (p.collateralUSD || 0)),
        0
      );
  
    let exceed = 0;
  
    for (let m = 0; m < paths; m++) {
      const next = rng(seedBase + m);
      let larTotal = 0;
  
      for (const pos of positions) {
        const sigmaAnn = Math.max(0, pos.sigma ?? 0.6);
        const sigmaStep = sigmaAnn * Math.sqrt(dt);
        const z = gaussianPRNG(next);
  
        // lognormal price multiplier: exp(-0.5 σ^2 dt + σ sqrt(dt) z)
        const mult = Math.exp(-0.5 * sigmaStep * sigmaStep + sigmaStep * z);
  
        const newCollat = Math.max(0, (pos.collateralUSD || 0) * mult);
        const ltvMax = Math.min(1, Math.max(0, pos.ltvMax ?? 0.8));
        const maxDebtSupported = newCollat * ltvMax;
        const shortfall = Math.max(0, (pos.debtUSD || 0) - maxDebtSupported);
        larTotal += shortfall;
      }
  
      if (larTotal >= holdingsUSD) exceed++;
    }
  
    return clamp01(exceed / paths);
  }
  
  /**
   * 3.3 Credit Utilization s_cu
   * \hat s_cu = Σ[(1 - L/(C*LTV)) * L] / Σ L  with safety floors to avoid outliers.
   */
  export function s_cu(loans?: Loan[]): number {
    const Ls = loans ?? [];
    const sumL = Ls.reduce((s, L) => s + Math.max(0, L.amountUSD), 0);
    if (sumL <= 0) return 1 / 3;
  
    let acc = 0;
    for (const L of Ls) {
      const C = Math.max(0, (L.collaterals ?? []).reduce((s, c) => s + Math.max(0, c.amountUSD), 0));
      const LTV = clamp01(L.ltvAtOpen);
      const denom = Math.max(1e-9, C * LTV);
      if (L.amountUSD / denom > 5) continue; // guard extreme glitches
      const term = (1 - L.amountUSD / denom) * L.amountUSD;
      acc += term;
    }
    return clamp01(acc / sumL);
  }
  
  /**
   * 3.4 On-Chain Transaction s_ct
   * \hat s_ct = (Σ T * S * t) / (Σ T), with S ∈ {+1,-1}, t recency weight.
   * Soft-cap per-tx USD to prevent whales from dominating.
   */
  export function s_ct(txs?: Transaction[], holdingsHintUSD?: number): number {
    const Ts = txs ?? [];
    if (Ts.length === 0) return 0;
  
    const dates = Ts.map((t) => new Date(t.ts));
    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
  
    const cap =
      Number(process.env.OCCR_TX_CAP_FRAC ?? 0.02) *
      Math.max(1, holdingsHintUSD ?? 1_000_000);
  
    let num = 0,
      den = 0;
  
    for (const t of Ts) {
      const T = Math.min(Math.max(0, t.amountUSD), cap);
      const S = t.credit ? 1 : -1;
      const w =
        typeof t.recencyWeight === "number"
          ? clamp01(t.recencyWeight)
          : logisticRecencyFromDate(new Date(t.ts), minDate, maxDate);
  
      num += T * S * w;
      den += T;
    }
  
    if (den <= 0) return 0;
    return Math.max(-1, Math.min(1, num / den));
  }
  
  /**
   * 3.5 New Credit s_nc (window default 30d)
   * Y=1 if L >= mean(L_window) AND ΔD <= mean(ΔD)  → \hat s_nc = ΣY / n_window
   */
  export function s_nc(loans?: Loan[], windowDays = Number(process.env.OCCR_NC_WINDOW_DAYS ?? 30)): number {
    const Ls = loans ?? [];
    if (Ls.length === 0) return 0;
  
    const now = new Date();
    const cutoff = new Date(now.getTime() - windowDays * 24 * 3600 * 1000);
    const recent = Ls.filter((l) => new Date(l.openedAt) >= cutoff);
    if (recent.length === 0) return 0;
  
    const meanL = recent.reduce((s, l) => s + Math.max(0, l.amountUSD), 0) / recent.length;
  
    // compute nearest-gap ΔD per loan in days
    const sorted = [...Ls].sort(
      (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
    );
    const gaps: Record<string, number> = {};
    for (let i = 0; i < sorted.length; i++) {
      const cur = new Date(sorted[i].openedAt).getTime();
      const prev = i > 0 ? new Date(sorted[i - 1].openedAt).getTime() : Number.NEGATIVE_INFINITY;
      const next = i < sorted.length - 1 ? new Date(sorted[i + 1].openedAt).getTime() : Number.POSITIVE_INFINITY;
      const d1 = isFinite(prev) ? cur - prev : Infinity;
      const d2 = isFinite(next) ? next - cur : Infinity;
      gaps[sorted[i].id] = Math.min(d1, d2) / (24 * 3600 * 1000);
    }
    const gapVals = Object.values(gaps).filter((x) => isFinite(x));
    const meanGap = gapVals.length ? gapVals.reduce((s, x) => s + x, 0) / gapVals.length : 30;
  
    let Ysum = 0;
    for (const l of recent) {
      const cond = Math.max(0, l.amountUSD) >= meanL && (gaps[l.id] ?? 999) <= meanGap;
      if (cond) Ysum += 1;
    }
    return clamp01(Ysum / recent.length);
  }
  
  /* -------------------------------- composite ------------------------------ */
  
  /**
   * Weighted composite (paper-esque):
   * OCCR = 0.35*s_h + 0.25*s_c + 0.15*(1 - s_cu) - 0.15*s_ct + 0.10*s_nc
   * Lower is better (probability of credit risk).
   */
  export function composite(sub: OCCRSubscores): OCCRResult {
    const occrProb = clamp01(
      0.35 * sub.s_h +
        0.25 * sub.s_c +
        0.15 * (1 - sub.s_cu) -
        0.15 * sub.s_ct +
        0.10 * sub.s_nc
    );
    const score1000 = Math.round(occrProb * 1000);
  
    // env-tunable tier thresholds; defaults are conservative
    const T_A = Number(process.env.TIER_A_MAX ?? 0.15);
    const T_B = Number(process.env.TIER_B_MAX ?? 0.30);
    const T_C = Number(process.env.TIER_C_MAX ?? 0.60);
  
    const tier = occrProb <= T_A ? "A" : occrProb <= T_B ? "B" : occrProb <= T_C ? "C" : "D";
  
    return { ...sub, occrProb, score1000, tier };
  }
  
  /* ----------------------- end-to-end portfolio compute -------------------- */
  
  export function computeOCCR(p: PortfolioSnapshot): OCCRResult {
    const loansHistory = p.loansHistory ?? [];
    const currentPositions = p.currentPositions ?? [];
    const holdingsUSD = Number.isFinite(p.holdingsUSD) ? p.holdingsUSD : 0;
    const transactions = p.transactions ?? [];
  
    const sH  = s_h(loansHistory);
    const sC  = s_c(currentPositions, holdingsUSD);
    const sCU = s_cu(loansHistory);
    const sCT = s_ct(transactions, holdingsUSD);
    const sNC = s_nc(loansHistory);
  
    return composite({ s_h: sH, s_c: sC, s_cu: sCU, s_ct: sCT, s_nc: sNC });
  }
  