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

const TIER = ["A", "B", "C", "D"];

export default function App() {
  const [net, setNet] = useState<NetKey>("hederaTestnet");
  const [addr, setAddr] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<null | {
    score: number;
    tier: string;
    algo: string;
    updated: string;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = useMemo(() => {
    const url = RPCS[net];
    if (!url) return null;
    return new ethers.JsonRpcProvider(url);
  }, [net]);

  const scorerAddress = SCORERS[net];

  async function getScore() {
    setError(null);
    setResult(null);
    if (!provider) {
      setError("Missing RPC for selected network.");
      return;
    }
    if (!ethers.isAddress(addr)) {
      setError("Invalid wallet address.");
      return;
    }
    if (!scorerAddress || !ethers.isAddress(scorerAddress)) {
      setError("Missing/invalid scorer address for this network.");
      return;
    }
    setLoading(true);
    try {
      const ctr = new ethers.Contract(scorerAddress, OCCR_SCORER_ABI, provider);
      const [score1000, tierUint, algorithmId, lastUpdated] = await ctr.calculateRiskScore(addr);
      const score = Number(score1000);
      const tier = TIER[Number(tierUint)] ?? "?";
      const algo = typeof algorithmId === "string" ? algorithmId : ethers.hexlify(algorithmId);
      const updated = new Date(Number(lastUpdated) * 1000).toLocaleString();

      setResult({ score, tier, algo, updated });
    } catch (e: any) {
      setError(e?.message ?? String(e));
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
        </div>
      )}

      <div style={{marginTop:24, fontSize:12, color:"#666"}}>
        Tip: On Hedera/RSK, if you used <code>occr:set</code> to seed a score,
        you should see it here. On Sepolia, run the off-chain compute pipeline
        and <code>occr:update</code> to push scores, then refresh.
      </div>
    </div>
  );
}
