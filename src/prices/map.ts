export const symbolToPythId: Record<string, string> = {
    ETH: process.env.PYTH_ID_ETHUSD!,
    WETH: process.env.PYTH_ID_ETHUSD!, // treat WETH≈ETH
    WBTC: process.env.PYTH_ID_WBTCUSD!,
    USDC: process.env.PYTH_ID_USDCUSD!,
    USDT: process.env.PYTH_ID_USDCUSD!, // approximate to $1 (or add its exact id)
    // add more as you need
  };
  