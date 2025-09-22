// src/occr/compute.ts
import { WalletView } from "./types.js";

export interface Subscores {
  s_h: number;    // historical
  s_c: number;    // current
  s_cu: number;   // credit utilization
  s_ct: number;   // on-chain tx
  s_nc: number;   // new credit
}

export interface Composite {
  subs: Subscores;
  occrProb: number;  // 0..1
  score1000: number; // 0..1000
  tier: "A" | "B" | "C" | "D";
}

export function computeFromWallet(view: WalletView): Composite {
  const s_h = historical(view);          // eq (1) with practical defaults
  const s_c = current(view);             // Monte Carlo proxy via LaR>H
  const s_cu = utilization(view);        // eq (4)
  const s_ct = onchainTx(view);          // eq (5)
  const s_nc = newCredit(view);          // eq (6)

  // OCCR composite per paper: 0.35 sh + 0.25 sc + 0.15 (1 - scu) - 0.15 sct + 0.10 snc   (eq 7)
  let p = 0.35*s_h + 0.25*s_c + 0.15*(1 - s_cu) - 0.15*s_ct + 0.10*s_nc;
  // Clamp to (0,1)
  p = Math.max(0, Math.min(1, p));

  const score1000 = Math.round(p * 1000);
  const tier = p < 0.25 ? "A" : p < 0.5 ? "B" : p < 0.75 ? "C" : "D";

  return { subs: { s_h, s_c, s_cu, s_ct, s_nc }, occrProb: p, score1000, tier };
}

// ==== helpers implementing the five subscores ====

function historical(view: WalletView): number {
  // ŝ_h = sum_j w_ij X_ij / sum_j w_ij where X=1 if liquidated else 0, and
  // w_ij = L_ij * (1 - r_ij) * p_ij * t_ij  (paper §3.1)
  const now = Date.now()/1000;
  const loans = view.loans;
  if (!loans.length) return 0.5; // uninformed prior
  let num = 0, den = 0;
  for (const L of loans) {
    const X = L.liquidated ? 1 : 0;
    // combined collateral risk r_{i,j} := Σ_k C_{i,j,k} * (σ_k / σ_max) / Σ_k C_{i,j,k}
    const totalC = L.collaterals.reduce((s,c)=>s + c.usdAtOpen, 0) || 1;
    const sigmaMax = Math.max(...L.collaterals.map(c=>c.volatility || 0.2), 0.2);
    const r = L.collaterals.reduce((s,c)=> s + c.usdAtOpen * ((c.volatility||0.2)/sigmaMax), 0) / totalC;
    const p_liq = L.liquidatedPortion ?? (L.liquidated ? 1 : 0.2);  // protocol liquidated fraction; heuristic if unknown
    // recency weight t_ij (sigmoid over months since open)
    const monthsAgo = (now - L.openedAt) / (30*24*3600);
    const t = 1/(1 + Math.exp(-(monthsAgo - 6))); // midpoint at ~6 months
    const w = L.loanUSD * (1 - r) * p_liq * t;
    num += w * X;
    den += w;
  }
  return den > 0 ? num/den : 0.5;
}

function current(view: WalletView): number {
  // ŝ_c = P(LaR_total >= H_i) via light Monte Carlo on a few price shocks
  // For Day-2, approximate LaR as fraction of open loans sensitive to collateral σ; if we have no live opens, return 0.
  const open = view.loans.filter(l => !l.closedAt);
  if (!open.length) return 0.0;

  const H = view.holding.totalUSD || 0;
  if (H <= 0) return 1.0; // zero holdings, bad

  const trials = 500; // keep small for speed
  let hits = 0;
  for (let t=0; t<trials; t++) {
    let larTotal = 0;
    for (const L of open) {
      // shock collateral basket by N(0, σ_basket) on price; σ_basket ~ weighted of component σ
      const totalC = L.collaterals.reduce((s,c)=>s + c.usdAtOpen, 0) || 1;
      const sigmaW = Math.sqrt(L.collaterals.reduce((s,c)=>{
        const w = c.usdAtOpen / totalC;
        const sig = c.volatility || 0.2;
        return s + w*w*sig*sig;
      }, 0));
      // one-step lognormal shock
      const z = boxMuller(); // ~N(0,1)
      const priceFactor = Math.exp(-0.5*sigmaW*sigmaW + sigmaW*z);
      const collateralNow = totalC * priceFactor;
      // If collateral value falls below debt/ltv, estimate liquidation need
      const need = Math.max(0, (L.loanUSD / (L.ltvAtOpen || 0.5)) - collateralNow);
      larTotal += Math.min(need, totalC); // cap by collateral
    }
    if (larTotal >= H) hits++;
  }
  return hits / trials;
}

function utilization(view: WalletView): number {
  // ŝ_cu = sum_j (1 - L_{i,j}/(C_{i,j} * LTV_{i,j})) * L_{i,j} / sum_j L_{i,j}  (paper §3.3)
  const loans = view.loans;
  const sumL = loans.reduce((s,l)=> s + l.loanUSD, 0);
  if (!sumL) return 1/3; // neutral per paper’s expectation baseline
  let acc = 0;
  for (const L of loans) {
    const C = L.collaterals.reduce((s,c)=> s + c.usdAtOpen, 0);
    const denom = C * (L.ltvAtOpen || 0.5) || 1;
    const term = (1 - (L.loanUSD / denom));
    acc += term * L.loanUSD;
  }
  const scu = acc / sumL;
  // Clamp to [0,1] to avoid weirdness if data noisy
  return Math.max(0, Math.min(1, scu));
}

function onchainTx(view: WalletView): number {
  // ŝ_ct = (Σ T_i,l * S_i,l * t_i,l) / (Σ |T_i,l|)  (paper §3.4)
  // We weight by recency in [0,1] over last N days.
  const txs = [...view.txs].sort((a,b)=>a.timestamp-b.timestamp);
  if (txs.length === 0) return 0.0;
  const now = Math.floor(Date.now()/1000);
  const horizon = 60 * 24 * 3600; // ~60 days lookback scaling
  let num = 0, den = 0;
  for (const t of txs) {
    const rec = Math.max(0, Math.min(1, 1 - (now - t.timestamp)/horizon));
    const sign = t.direction === "credit" ? +1 : -1;
    num += t.valueUSD * sign * rec;
    den += Math.abs(t.valueUSD);
  }
  if (den === 0) return 0.0;
  // Paper’s expectation tends to (2p-1)*E[rec]; clamp to [-1,1], then re-map to [0,1] with affine?
  // The paper uses it as additive with negative weight, so keep it in [-1,1] and rely on -0.15 factor.
  const raw = num / den;
  // But we’ll clamp to [-1,1] to be safe
  return Math.max(-1, Math.min(1, raw));
}

function newCredit(view: WalletView): number {
  // ŝ_nc = (# recent loans with L >= μ_L and ΔD <= μ_ΔD) / n_recent  (paper §3.5)
  const loans = view.loans.slice().sort((a,b)=>a.openedAt-b.openedAt);
  if (loans.length < 3) return 0.0;
  // recent window: last 30 days
  const cutoff = (Date.now()/1000) - 30*24*3600;
  const recent = loans.filter(l => l.openedAt >= cutoff);
  if (!recent.length) return 0.0;

  const muL = recent.reduce((s,l)=>s+l.loanUSD,0) / recent.length;

  // ΔD_j = min(D_j - D_{j-1}, D_{j+1}-D_j) among chron order
  const gaps: number[] = [];
  for (let i=0;i<loans.length;i++){
    const prev = i>0 ? loans[i].openedAt : undefined;
    const next = i<loans.length-1 ? loans[i+1].openedAt : undefined;
    if (prev && next) gaps.push(Math.min(loans[i].openedAt - prev, next - loans[i].openedAt));
  }
  const muGap = gaps.length ? gaps.reduce((a,b)=>a+b,0)/gaps.length : 7*24*3600;

  let hits = 0;
  for (const l of recent) {
    const idx = loans.findIndex(x => x.loanId === l.loanId);
    const prev = idx>0 ? loans[idx-1].openedAt : undefined;
    const next = idx<loans.length-1 ? loans[idx+1].openedAt : undefined;
    const dmin = (prev && next) ? Math.min(l.openedAt - prev, next - l.openedAt) : muGap;
    if (l.loanUSD >= muL && dmin <= muGap) hits++;
  }
  return hits / recent.length;
}

function boxMuller(): number {
  // standard normal
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
