import 'dotenv/config';
import fetch from 'cross-fetch';

export type PythPrice = { id: string; price: number; conf: number; publishTime: number };

function toFloat(price: { price: number; expo: number }) {
  return price.price * Math.pow(10, price.expo); // expo is often negative
}

/** Fetch latest mid prices for given Pyth price feed IDs */
export async function fetchPythLatest(ids: string[]): Promise<Record<string, PythPrice>> {
  const base = process.env.PYTH_HERMES || 'https://hermes.pyth.network';
  const qs = ids.map(id => `ids[]=${id}`).join('&');
  const url = `${base}/v2/updates/price/latest?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hermes latest failed: ${res.status}`);
  const json = await res.json();

  // Hermes returns either {parsed: [...]} or {prices: [...]} depending on route
  const rows = (json.parsed ?? json.prices ?? []) as any[];

  const out: Record<string, PythPrice> = {};
  for (const row of rows) {
    const id = row.id ?? row.price_id;
    const p = row.price ?? row.price_feed?.price;
    const conf = (row.price?.conf ?? row.conf) ?? 0;
    if (!id || !p) continue;
    out[id] = {
      id,
      price: toFloat(p),
      conf,
      publishTime: row.price?.publish_time ?? row.publish_time ?? 0,
    };
  }
  return out;
}
