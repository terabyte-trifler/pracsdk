import { CurrentPosition, Loan, OCCRResult, OCCRSubscores, PortfolioSnapshot, Transaction } from "../types.js";

/**
 * Utility: clamp to [0,1]
 */
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Logistic recency scaler for a loan start "month index" dti versus mid-point k
 * ti,j = 1 / (1 + e^{-(dti - k)})
 * If you don't have true month indices, we compute by linear mapping of dates.
 */
function logisticRecencyFromDate(d: Date, minDate: Date, maxDate: Date) {
  const spanMs = maxDate.getTime() - minDate.getTime();
  if (spanMs <= 0) return 0.5;
  const x = (d.getTime() - minDate.getTime()) / spanMs; // 0..1
  const k = 0.5; // mid
  return 1 / (1 + Math.exp(-(x - k) * 10)); // steeper slope for recency emphasis
}

/**
 * Combined collateral risk r_{i,j} = Sum_k C_{i,j,k} * (sigma_k / sigma_max) / Sum_k C_{i,j,k}
 */
function collateralRisk(collats: {amountUSD:number; sigma?:number}[]): number {
  if (collats.length === 0) return 0.5;
  const sigmas = collats.map(c => c.sigma ?? 0.6); // default sigma if missing
  const sigmaMax = Math.max(...sigmas, 1e-9);
  const totalC = collats.reduce((s,c)=>s+c.amountUSD, 0);
  if (totalC <= 0) return 0.5;
  const wsum = collats.reduce((s,c,i)=> s + c.amountUSD * (sigmas[i]/sigmaMax), 0);
  return wsum / totalC; // in [0,1]
}

/**
 * 3.1 Historical Credit Risk subscore s_h:
 * ŝ_h = (Σ_j w_{i,j} X_{i,j}) / (Σ_j w_{i,j}),
 * with weights w = L * (1 - r) * p * t  (see paper Sec. 3.1).
 */
export function s_h(loansHistory: Loan[]): number {
  if (loansHistory.length === 0) return 0.5;
  const dates = loansHistory.map(l => new Date(l.openedAt));
  const minDate = new Date(Math.min(...dates.map(d=>d.getTime())));
  const maxDate = new Date(Math.max(...dates.map(d=>d.getTime())));

  let num = 0, den = 0;
  for (const L of loansHistory) {
    const Lamt = Math.max(0, L.amountUSD);
    const r = collateralRisk(L.collaterals);               // in [0,1]
    const p = L.liquidated ? (L.liquidatedProportion ?? 1) : (L.liquidatedProportion ?? 0.0);
    const t = logisticRecencyFromDate(new Date(L.openedAt), minDate, maxDate);
    const w = Lamt * (1 - r) * p * t;
    den += w;
    if (L.liquidated) num += w;  // Xi,j = 1 if liquidated else 0
  }
  if (den <= 0) return 0.0;
  return clamp01(num / den);
}

/**
 * 3.2 Current Credit Risk subscore s_c:
 * Monte Carlo approximation of P(LaR_total >= H_i).
 * For each position, simulate price shock ~ Normal(0, sigma), compute liquidation shortfall.
 */
export function s_c(current: CurrentPosition[], holdingsUSD: number, paths = 1000): number {
  if (current.length === 0) return 0.0;
  if (holdingsUSD < 0) holdingsUSD = 0;

  let exceed = 0;
  for (let m = 0; m < paths; m++) {
    let larTotal = 0;
    for (const pos of current) {
      const sigma = pos.sigma ?? 0.6; // crude default if unknown
      // single-step shock; for hackathon we use N(0, sigma). You can swap a fatter tail if desired.
      const z = gaussian();
      const shock = z * sigma; // percent move approx
      const newCollat = Math.max(0, pos.collateralUSD * Math.exp(shock * -1)); // adverse downward
      const ltvMax = pos.ltvMax ?? 0.8;
      const maxDebtSupported = newCollat * ltvMax;
      const shortfall = Math.max(0, pos.debtUSD - maxDebtSupported);
      larTotal += shortfall;
    }
    if (larTotal >= holdingsUSD) exceed++;
  }
  return clamp01(exceed / paths);
}

// simple Box–Muller normal
function gaussian(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * 3.3 Credit Utilization subscore s_cu:
 * ŝ_cu = Σ_j [ (1 - L / (C * LTV)) * L ] / Σ_j L
 * Note: expect ~1/3 + small correction under the model; here we compute directly from inputs.
 */
export function s_cu(loans: Loan[]): number {
  const sumL = loans.reduce((s, L)=> s + Math.max(0, L.amountUSD), 0);
  if (sumL <= 0) return 1/3;
  let acc = 0;
  for (const L of loans) {
    const C = Math.max(0, L.collaterals.reduce((s,c)=> s + c.amountUSD, 0));
    const LTV = clamp01(L.ltvAtOpen);
    if (C <= 0 || LTV <= 0) continue;
    const term = (1 - (L.amountUSD / (C * LTV))) * L.amountUSD;
    acc += term;
  }
  return clamp01(acc / sumL);
}

/**
 * 3.4 On-Chain Transaction subscore s_ct:
 * ŝ_ct = (Σ_l T_i,l S_i,l t_i,l) / (Σ_l T_i,l),
 * with S=+1 for credit, -1 for debit, and t in [0,1] (recency weight).
 */
export function s_ct(txs: Transaction[]): number {
  if (txs.length === 0) return 0;
  const dates = txs.map(t => new Date(t.ts));
  const minDate = new Date(Math.min(...dates.map(d=>d.getTime())));
  const maxDate = new Date(Math.max(...dates.map(d=>d.getTime())));

  let num = 0, den = 0;
  for (const t of txs) {
    const T = Math.max(0, t.amountUSD);
    const S = t.credit ? 1 : -1;
    const w = typeof t.recencyWeight === 'number'
      ? clamp01(t.recencyWeight)
      : logisticRecencyFromDate(new Date(t.ts), minDate, maxDate);
    num += T * S * w;
    den += T;
  }
  if (den <= 0) return 0;
  // Paper allows negative values; clamp to [-1,1] then map to [-1,1] for combination step
  return Math.max(-1, Math.min(1, num / den));
}

/**
 * 3.5 New Credit subscore s_nc:
 * In the last window (default 30d), Y=1 if L >= mean(L_lastMonth) AND ΔD <= mean(ΔD),
 * ŝ_nc = (Σ Y) / n_lastMonth.
 */
export function s_nc(loans: Loan[], windowDays = 30): number {
  if (loans.length === 0) return 0;
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowDays*24*3600*1000);
  const recent = loans.filter(l => new Date(l.openedAt) >= cutoff);
  if (recent.length === 0) return 0;

  // mean L in window
  const meanL = recent.reduce((s,l)=>s+l.amountUSD, 0) / recent.length;

  // compute ΔD for each loan: min gap to prev/next in the wallet time series
  const sorted = [...loans].sort((a,b)=> new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
  const gaps: Record<string, number> = {};
  for (let i=0;i<sorted.length;i++){
    const cur = new Date(sorted[i].openedAt).getTime();
    const prev = i>0 ? new Date(sorted[i-1].openedAt).getTime() : Number.NEGATIVE_INFINITY;
    const next = i<sorted.length-1 ? new Date(sorted[i+1].openedAt).getTime() : Number.POSITIVE_INFINITY;
    const d1 = isFinite(prev) ? (cur - prev) : Infinity;
    const d2 = isFinite(next) ? (next - cur) : Infinity;
    gaps[sorted[i].id] = Math.min(d1, d2) / (24*3600*1000); // days
  }
  const meanGap = Object.values(gaps).filter(x=>isFinite(x)).reduce((s,x)=>s+x,0) / Object.values(gaps).length;

  let Ysum = 0;
  for (const l of recent) {
    const cond = (l.amountUSD >= meanL) && (gaps[l.id] <= meanGap);
    if (cond) Ysum += 1;
  }
  return clamp01(Ysum / recent.length);
}

/**
 * Weighted composite (paper Eq. 7):
 * OCCR = 0.35*s_h + 0.25*s_c + 0.15*(1 - s_cu) - 0.15*s_ct + 0.10*s_nc
 * Output: 0..1 probability, score1000, and A-D tier.
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

  // Lower probability is better (A). Tunable thresholds:
  const tier =
    occrProb <= 0.15 ? 'A' :
    occrProb <= 0.30 ? 'B' :
    occrProb <= 0.60 ? 'C' : 'D';

  return { ...sub, occrProb, score1000, tier };
}

/**
 * End-to-end compute for a portfolio snapshot
 */
export function computeOCCR(p: PortfolioSnapshot): OCCRResult {
  const sH = s_h(p.loansHistory);
  const sC = s_c(p.currentPositions, p.holdingsUSD, 1000);
  const sCU = s_cu(p.loansHistory);
  const sCT = s_ct(p.transactions);
  const sNC = s_nc(p.loansHistory, 30);
  return composite({ s_h: sH, s_c: sC, s_cu: sCU, s_ct: sCT, s_nc: sNC });
}
