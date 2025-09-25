// functions/occr-source.js
//
// Chainlink Functions source code (runs off-chain inside DON).
// It returns ABI-encoded bytes: (uint256 score1000, uint8 tier, bytes32 algorithmId, uint256 lastUpdated).
//
// ── Inputs you pass at request-time ───────────────────────────────────────────
//  args[0] = user address (checksummed or lowercased 0x…)
//  args[1] = CSV of Pyth price IDs you care about (e.g., ETH, WBTC, USDC) — optional
//  args[2] = algorithmId as a string (e.g. "probabilistic-bayes-v1") — optional
//
// ── Secrets (DON / encrypted) you set before running ─────────────────────────
//  secrets.alchemyRpc  -> e.g. "https://eth-sepolia.g.alchemy.com/v2/<KEY>"
//  secrets.hermesBase  -> e.g. "https://hermes.pyth.network"
//  secrets.aaveSubgraph  (optional)
//  secrets.compSubgraph  (optional)
//
// NOTE: This is hackathon-grade and resilient to partial data. You can harden later.

const ABI = new ethers.AbiCoder();

// ----- helpers ---------------------------------------------------------------
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function tierFromProb(p) {
  // Lower is better
  if (p <= 0.15) return 0; // A
  if (p <= 0.30) return 1; // B
  if (p <= 0.60) return 2; // C
  return 3;                // D
}

function toBytes32String(str) {
  try {
    return ethers.encodeBytes32String(str);
  } catch {
    // If not encodable (too long), return a default id:
    return ethers.encodeBytes32String("probabilistic-bayes-v1");
  }
}

function nowSec() { return Math.floor(Date.now() / 1000); }

// Very simple normal RNG (not used heavily here; left for future MC upgrades)
function gaussian() {
  let u=0, v=0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ----- 1) Fetch wallet balances via JSON-RPC (Alchemy) ----------------------
async function fetchNativeBalance(user) {
  const res = await Functions.makeHttpRequest({
    url: secrets.alchemyRpc,
    method: "POST",
    headers: { "content-type": "application/json" },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [user, "latest"]
    }
  });
  if (!res || !res.data || !res.data.result) return 0;
  return Number(BigInt(res.data.result));
}

// If you have a tokenlist/portfolio indexer, plug it here.
// For hackathon speed, we’ll skip full ERC20 enumeration and just value native.
async function fetchErc20Balances(/*user*/) {
  // You can extend this: call `alchemy_getTokenBalances` or your indexer.
  return []; // keep it simple for now
}

// ----- 2) Pyth Hermes: latest price(s) --------------------------------------
async function fetchPythLatest(priceIds) {
  if (!priceIds || priceIds.length === 0) return {};
  const out = {};
  // Hermes latest endpoint (per price ID)
  for (const id of priceIds) {
    try {
      const r = await Functions.makeHttpRequest({
        url: `${secrets.hermesBase}/v2/price/latest`,
        params: { ids: id },
        timeout: 9000
      });
      const p = r?.data?.prices?.[0];
      if (p && p.price?.price && p.price?.expo !== undefined) {
        // Convert fixed-point price to float
        const px = Number(p.price.price) * Math.pow(10, Number(p.price.expo));
        out[id] = px;
      }
    } catch (e) {
      // continue
    }
  }
  return out;
}

// Map native coin → one Pyth ID (if provided). Otherwise default a price.
function pickNativePrice(prices, idsCsv) {
  if (!idsCsv) return 2000; // fallback (e.g., ETH ≈ $2k)
  const firstId = idsCsv.split(",")[0]?.trim();
  if (firstId && prices[firstId] && isFinite(prices[firstId])) return prices[firstId];
  return 2000;
}

// ----- 3) Aave/Compound (optional) ------------------------------------------
async function fetchAave(user) {
  if (!secrets.aaveSubgraph) return null;
  const q = `
    query($user: String!) {
      userReserves(where: { user: $user }) {
        reserve { symbol decimals }
        scaledVariableDebt
      }
      liquidations(where: { user: $user }) { id }
    }
  `;
  try {
    const r = await Functions.makeHttpRequest({
      url: secrets.aaveSubgraph,
      method: "POST",
      headers: { "content-type": "application/json" },
      data: { query: q, variables: { user: user.toLowerCase() } },
      timeout: 15000
    });
    return r?.data?.data || null;
  } catch {
    return null;
  }
}

async function fetchComp(user) {
  if (!secrets.compSubgraph) return null;
  const q = `
    query($user: String!) {
      accounts(where: { id: $user }) {
        id
        positions {
          asset { symbol decimals }
          borrowBalance
        }
      }
      liquidations(where: { borrower: $user }) { id }
    }
  `;
  try {
    const r = await Functions.makeHttpRequest({
      url: secrets.compSubgraph,
      method: "POST",
      headers: { "content-type": "application/json" },
      data: { query: q, variables: { user: user.toLowerCase() } },
      timeout: 15000
    });
    return r?.data?.data || null;
  } catch {
    return null;
  }
}

// ----- 4) Minimal OCCR math (same shape as your Node task) ------------------
function computeSimplifiedOCCR(features) {
  // features = { nativeUsd, liquidationEvents, borrowUsd, sigmaAnnualized }
  // Very light version of: OCCR = 0.35*s_h + 0.25*s_c + 0.15*(1-s_cu) - 0.15*s_ct + 0.10*s_nc

  // s_h: if liquidations > 0, increase risk; else 0
  const s_h = features.liquidationEvents > 0 ? 0.7 : 0.0;

  // s_c: approximate via utilization*vol multiplier
  const util = features.nativeUsd > 0 ? Math.min(features.borrowUsd / features.nativeUsd, 1) : 0;
  const s_c = clamp01(0.5 * util + 0.5 * (features.sigmaAnnualized ?? 0.6));

  // s_cu: credit utilization inverted
  const s_cu = clamp01(1 - util); // higher util => worse (so 1-util)

  // s_ct, s_nc: placeholders for now
  const s_ct = 0.0;
  const s_nc = 0.0;

  const occrProb = clamp01(0.35*s_h + 0.25*s_c + 0.15*(1 - s_cu) - 0.15*s_ct + 0.10*s_nc);
  const score1000 = Math.round(occrProb * 1000);
  const tier = tierFromProb(occrProb);
  return { occrProb, score1000, tier };
}

// ----- MAIN -----------------------------------------------------------------
if (!args || !args[0]) {
  throw Error("Missing args[0] = user address");
}
if (!secrets || !secrets.alchemyRpc || !secrets.hermesBase) {
  throw Error("Missing required secrets: alchemyRpc, hermesBase");
}

const user = ethers.getAddress(args[0]);
const pythIdsCsv = args[1] || "";
const algorithmIdStr = args[2] || "probabilistic-bayes-v1";

// 1) balances
const nativeWei = await fetchNativeBalance(user);
// (extend here: erc20 balances via alchemy_getTokenBalances)
const tokens = await fetchErc20Balances(user);

// 2) prices
const priceIds = pythIdsCsv
  ? pythIdsCsv.split(",").map(s => s.trim()).filter(Boolean)
  : [];
const prices = await fetchPythLatest(priceIds);
const nativePx = pickNativePrice(prices, pythIdsCsv);
const nativeUsd = Number(nativeWei) / 1e18 * nativePx;

// 3) protocol borrows & liquidations (optional)
const aave = await fetchAave(user);
const comp = await fetchComp(user);

let liquidations = 0;
if (aave?.liquidations) liquidations += aave.liquidations.length;
if (comp?.liquidations) liquidations += comp.liquidations.length;

let borrowUsd = 0;
// crude: Aave variable debt units * price (missing per-asset map -> treat as native)
if (aave?.userReserves?.length) {
  for (const ur of aave.userReserves) {
    const dec = Number(ur?.reserve?.decimals ?? 18);
    const units = Number(ur?.scaledVariableDebt ?? 0) / (10 ** dec);
    borrowUsd += units * nativePx;
  }
}
if (comp?.accounts?.length) {
  const positions = comp.accounts[0]?.positions ?? [];
  for (const p of positions) {
    const dec = Number(p?.asset?.decimals ?? 18);
    const units = Number(p?.borrowBalance ?? 0) / (10 ** dec);
    borrowUsd += units * nativePx;
  }
}

// 4) compute simplified OCCR
const occr = computeSimplifiedOCCR({
  nativeUsd,
  liquidationEvents: liquidations,
  borrowUsd,
  sigmaAnnualized: 0.6 // TODO: roll from Hermes history if you want
});

// 5) ABI-encode result for your consumer to decode & forward to OCCRScorer.updateScore
const algoBytes32 = toBytes32String(algorithmIdStr);
const payload = ABI.encode(
  ["uint256", "uint8", "bytes32", "uint256"],
  [BigInt(occr.score1000), occr.tier, algoBytes32, BigInt(nowSec())]
);

// Chainlink Functions expects bytes; return as hex
return Functions.encodeHexString(payload);
