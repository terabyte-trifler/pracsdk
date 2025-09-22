import 'dotenv/config';
import { Alchemy, Network } from 'alchemy-sdk';
import { ethers } from 'ethers';

const ALCHEMY_RPC = process.env.ALCHEMY_RPC!;
if (!ALCHEMY_RPC) throw new Error('Set ALCHEMY_RPC in .env');

export type Erc20 = {
  contractAddress: string;
  symbol: string;
  decimals: number;
  raw: string;            // raw string balance
  balance: number;        // normalized (10^-decimals)
};

export type WalletBalances = {
  nativeEthWei: bigint;
  nativeEth: number;
  tokens: Erc20[];
};

export async function fetchWalletBalances(user: string): Promise<WalletBalances> {
  const provider = new ethers.JsonRpcProvider(ALCHEMY_RPC);
  const alch = new Alchemy({ url: ALCHEMY_RPC, network: Network.ETH_MAINNET });

  // 1) ETH balance
  const wei = await provider.getBalance(user);

  // 2) All ERC-20 balances (nonzero) via Alchemy Token API
  const tokRes = await alch.core.getTokenBalances(user);
  const nonZero = tokRes.tokenBalances.filter(t => t.tokenBalance !== '0' && t.contractAddress);

  // 3) Get metadata (symbol/decimals) for those contracts
  const metas = await Promise.all(
    nonZero.map(t => alch.core.getTokenMetadata(t.contractAddress))
  );

  const tokens: Erc20[] = nonZero.map((t, i) => {
    const m = metas[i];
    const decimals = m.decimals ?? 18;
    const bn = BigInt(t.tokenBalance!);
    const balance = Number(bn) / 10 ** decimals;
    return {
      contractAddress: t.contractAddress,
      symbol: (m.symbol ?? '').toUpperCase(),
      decimals,
      raw: t.tokenBalance!,
      balance,
    };
  });

  return {
    nativeEthWei: wei,
    nativeEth: Number(wei) / 1e18,
    tokens,
  };
}
