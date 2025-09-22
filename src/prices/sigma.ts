import { fetchPythHistory } from "./pyth"; // you already have a Hermes fetcher

export async function rollingSigmaFromPyth(priceId: string, lookbackMin = 1440): Promise<number> {
  // fetch OHLC or tick series from Hermes (your fetcher should return [{ts, price}, ...])
  const series = await fetchPythHistory(priceId, lookbackMin);
  // compute log-returns
  const rets: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const p0 = series[i-1].price;
    const p1 = series[i].price;
    if (p0 > 0 && p1 > 0) rets.push(Math.log(p1/p0));
  }
  if (rets.length < 3) return 0.6; // fallback
  const mean = rets.reduce((s,x)=>s+x,0)/rets.length;
  const var_ = rets.reduce((s,x)=>s+(x-mean)*(x-mean),0)/(rets.length-1);
  const sigmaStep = Math.sqrt(var_);
  // scale to annualized (assume N steps per day, 252 days/yr). If series is minute bars: 60*24=1440 steps/day.
  const stepsPerDay = Math.max(1, Math.round(series.length / (lookbackMin || 1440)));
  const sigmaDaily = sigmaStep * Math.sqrt(stepsPerDay);
  const sigmaAnnual = sigmaDaily * Math.sqrt(252);
  return Math.min(3.0, Math.max(0.05, sigmaAnnual)); // clamp
}
