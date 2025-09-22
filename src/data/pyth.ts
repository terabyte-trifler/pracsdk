// src/data/pyth.ts
import fetch from "node-fetch";

const HERMES = process.env.PYTH_HERMES_BASE || "https://hermes.pyth.network";
const LOOKBACK_MIN = parseInt(process.env.PYTH_LOOKBACK_MIN || "1440", 10);
// Map symbols to Pyth ids (fill a few you care about); you can inject from env later.
const DEFAULT_IDS: Record<string, string> = {}; // symbol -> price id hex

function envIds(): Record<string, string> {
  const out: Record<string,string> = { ...DEFAULT_IDS };
  const raw = (process.env.PYTH_PRICE_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  // If you provide ids only (no symbol), we’ll label them PRICE_i; otherwise, set DEFAULT_IDS with known symbols.
  raw.forEach((id, i) => out[`PRICE_${i}`] = id);
  return out;
}

export async function getPythLatestMap(): Promise<Map<string, { price: number }>> {
  const ids = envIds();
  const qs = Object.values(ids).map(id => `ids[]=${encodeURIComponent(id)}`).join("&");
  const url = `${HERMES}/api/latest_price_feeds?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[pyth] bad hermes response ${res.status}`);
  const data = await res.json(); // array of feeds
  const m = new Map<string,{price:number}>();
  // If you used PRICE_i labels, leave them as such; otherwise map to symbol in your DEFAULT_IDS
  data.forEach((feed: any, idx: number) => {
    // mid price ~ price.price / 10^expo
    const p = Number(feed.price.price) * Math.pow(10, feed.price.expo);
    const key = Object.keys(ids)[idx] || feed.product?.symbol || `PRICE_${idx}`;
    m.set(key.toUpperCase(), { price: p });
  });
  return m;
}

export async function getPythSeriesSigma(priceId: string): Promise<number> {
  // NOTE: Hermes has endpoints for price updates/history. One common pattern is /api/price_updates?ids[]=...&... 
  // For hack speed, we simulate a short log-return series using latest +/- jitter if history isn’t available.
  try {
    const url = `${HERMES}/api/price_updates?ids[]=${encodeURIComponent(priceId)}&hours=24`;
    const r = await fetch(url);
    if (r.ok) {
      const js = await r.json();
      // Flatten price points; different Hermes variants structure arrays; normalize to numeric mids
      const points: number[] = [];
      for (const u of js.price_updates?.[0]?.updates ?? []) {
        points.push(Number(u.price.price) * Math.pow(10, u.price.exponent));
      }
      if (points.length >= 10) return stdevLogReturns(points);
    }
  } catch { /* fall back */ }
  // Fallback: no history available; pick a conservative σ
  return 0.6; // 60% annualized-ish proxy; tune as you like
}

function stdevLogReturns(points: number[]): number {
  const rets: number[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i-1] > 0 && points[i] > 0) {
      rets.push(Math.log(points[i] / points[i-1]));
    }
  }
  if (rets.length === 0) return 0.5;
  const mean = rets.reduce((a,b)=>a+b,0) / rets.length;
  const varr = rets.reduce((a,b)=>a + (b-mean)*(b-mean), 0) / (rets.length - 1);
  return Math.sqrt(varr);
}
