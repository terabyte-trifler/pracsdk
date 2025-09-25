import { useMemo, useState } from "react";
import { ethers } from "ethers";
import { OCCR_SCORER_ABI } from "./abi/OCCRScorer";

type NetKey = "sepolia" | "rskTestnet" | "hederaTestnet";

const RPCS: Record<NetKey, string> = {
  sepolia: import.meta.env.VITE_RPC_SEPOLIA,
  rskTestnet: import.meta.env.VITE_RPC_RSK,
  hederaTestnet: import.meta.env.VITE_RPC_HEDERA,
};

const SCORERS: Record<NetKey, string> = {
  sepolia: import.meta.env.VITE_SCORER_SEPOLIA,
  rskTestnet: import.meta.env.VITE_SCORER_RSK,
  hederaTestnet: import.meta.env.VITE_SCORER_HEDERA,
};

const TIER = ["A", "B", "C", "D"] as const;

function decodeAlgoId(hex32: string): string {
  try {
    return ethers.decodeBytes32String(hex32);
  } catch {
    return hex32; // fallback to 0x… if not a valid bytes32 string
  }
}

export default function App() {
  const [net, setNet] = useState<NetKey>("hederaTestnet");
  const [addr, setAddr] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<null | {
    score: number;
    tier: string;
    algo: string;
    updated: string;
    rawUpdated: number;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  const rpcUrl = RPCS[net];
  const scorerAddress = SCORERS[net];

  const provider = useMemo(() => {
    if (!rpcUrl) return null;
    return new ethers.JsonRpcProvider(rpcUrl);
  }, [rpcUrl]);

  async function getScore() {
    setError(null);
    setResult(null);

    if (!provider) {
      setError(`Missing RPC for ${net}. Set VITE_RPC_* in ui/.env`);
      return;
    }
    if (!scorerAddress || !ethers.isAddress(scorerAddress)) {
      setError(`Missing/invalid scorer address for ${net}. Set VITE_SCORER_* in ui/.env`);
      return;
    }
    if (!ethers.isAddress(addr)) {
      setError("Invalid wallet address.");
      return;
    }

    setLoading(true);
    try {
      const ctr = new ethers.Contract(scorerAddress, OCCR_SCORER_ABI, provider);
      // 4-return signature
      const [score1000, tierUint, algorithmId, lastUpdated] =
        await ctr.calculateRiskScore(ethers.getAddress(addr));

      const score = Number(score1000);
      const tier = TIER[Number(tierUint)] ?? "?";
      const algo = decodeAlgoId(typeof algorithmId === "string" ? algorithmId : ethers.hexlify(algorithmId));
      const lu = Number(lastUpdated);
      const updated = lu > 0 ? new Date(lu * 1000).toLocaleString() : "Not set / stale";

      setResult({ score, tier, algo, updated, rawUpdated: lu });
    } catch (e: any) {
      // Common decode error => ABI mismatch or wrong contract address
      const msg = e?.shortMessage || e?.message || String(e);
      setError(msg.includes("could not decode")
        ? `${msg} — Check ABI and that the contract on ${net} matches the 4-value calculateRiskScore signature.`
        : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{maxWidth: 720, margin: "40px auto", fontFamily: "Inter, system-ui, sans-serif"}}>
      <h1>OCCR — On-Chain Credit Score (Multi-Chain)</h1>

      <div style={{display:"grid", gap:12, marginTop:16}}>
        <label>
          Network:&nbsp;
          <select value={net} onChange={e => setNet(e.target.value as NetKey)}>
            <option value="hederaTestnet">Hedera Testnet</option>
            <option value="rskTestnet">Rootstock Testnet</option>
            <option value="sepolia">Ethereum Sepolia</option>
          </select>
        </label>

        <small style={{opacity:0.7}}>
          RPC: {rpcUrl || "(not set)"} <br/>
          Scorer: {scorerAddress || "(not set)"}
        </small>

        <label>
          Wallet Address:&nbsp;
          <input
            style={{width:"100%"}}
            placeholder="0x…"
            value={addr}
            onChange={e => setAddr(e.target.value.trim())}
          />
        </label>

        <button onClick={getScore} disabled={loading}>
          {loading ? "Fetching…" : "Get My Credit Score"}
        </button>
      </div>

      {error && (
        <div style={{marginTop:16, color:"#b00020"}}>Error: {error}</div>
      )}

      {result && (
        <div style={{marginTop:24, padding:16, border:"1px solid #ddd", borderRadius:12}}>
          <h3>Result</h3>
          <p><b>Score:</b> {result.score} / 1000</p>
          <p><b>Tier:</b> {result.tier}</p>
          <p><b>Algorithm:</b> {result.algo}</p>
          <p><b>Last Updated:</b> {result.updated}</p>
          {result.rawUpdated === 0 && (
            <small style={{color:"#666"}}>
              (Tip: push a score with <code>occr:update</code> on Sepolia or <code>occr:set</code> on Hedera/RSK)
            </small>
          )}
        </div>
      )}

      <div style={{marginTop:24, fontSize:12, color:"#666"}}>
        If you still see decode errors: 1) ensure the contract on this network
        is the latest OCCRScorer (4-value <code>calculateRiskScore</code>), and 2) ensure this UI
        ABI matches your deployed bytecode.
      </div>
    </div>
  );
}

/*export default function App() {
  return (
    <div style={{padding:20,fontFamily:'Inter,system-ui'}}>
      <h1>OCCR — smoke test</h1>
      <p>If you can read this, React is rendering. Next we’ll re-enable web3.</p>
    </div>
  );
}*/

