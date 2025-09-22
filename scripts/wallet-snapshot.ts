import 'dotenv/config';
import { fetchWalletBalances } from '../src/wallet/alchemy';
import { toUSD } from '../src/wallet/valuations';

async function main() {
  const user = process.argv[2] ?? '0x1111111111111111111111111111111111111111';
  const bal = await fetchWalletBalances(user);
  const view = await toUSD(bal);

  console.log('ETH:', bal.nativeEth);
  console.table(view.components.sort((a,b) => b.usd - a.usd));
  console.log('Total USD ~', view.totalUsd.toFixed(2));
}

main().catch(console.error);
