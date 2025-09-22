import { fetchPythLatest } from '../prices/pyth';
import { symbolToPythId } from '../prices/map';
import type { WalletBalances } from './alchemy';

export type WalletUSDView = {
  totalUsd: number;
  components: Array<{ label: string; amount: number; usd: number; priceId?: string }>;
};

export async function toUSD(bal: WalletBalances): Promise<WalletUSDView> {
  // Build the list of price feed IDs we need
  const idsSet = new Set<string>();
  // ETH
  if (symbolToPythId.ETH) idsSet.add(symbolToPythId.ETH);
  // Tokens
  for (const t of bal.tokens) {
    const id = symbolToPythId[t.symbol];
    if (id) idsSet.add(id);
  }
  const ids = [...idsSet];
  const prices = await fetchPythLatest(ids);

  // helper to pick price by symbol
  const px = (sym: string) => {
    const id = symbolToPythId[sym];
    if (!id) return undefined;
    return prices[id]?.price;
  };

  const components: WalletUSDView['components'] = [];
  let totalUsd = 0;

  // ETH first
  const ethPx = px('ETH') ?? 0;
  const ethUsd = bal.nativeEth * ethPx;
  totalUsd += ethUsd;
  components.push({ label: 'ETH', amount: bal.nativeEth, usd: ethUsd, priceId: symbolToPythId.ETH });

  // Tokens
  for (const t of bal.tokens) {
    const price = px(t.symbol);
    const usd = price ? t.balance * price : 0;
    totalUsd += usd;
    components.push({ label: t.symbol, amount: t.balance, usd, priceId: price ? symbolToPythId[t.symbol] : undefined });
  }

  return { totalUsd, components };
}
