import { useMemo, useState } from "react";
import { JsonRpcProvider, Contract, isAddress, getAddress } from "ethers";
import { OCCR_ABI } from "./abi/OCCRScorer";
import { NETWORKS, NetKey } from "./config";

type ScoreView = {
  score: number;
  tier: string;
  lastUpdated?: number;
  algorithmId?: string;
};

function fmtTier(t?: number | string) {
  // if contract returns uint8 tier (0..3), map to A..D
  if (typeof t === "number") return ["A", "B", "C", "D"][t] ?? "?";
  return String(t ?? "?");
}

export default function App() {
  const [net, setNet] = useState<NetKey>("sepolia");
  const [addr, setAddr] = useState("");
  const [minScore, setMinScore] = useState("600");
  const [score, setScore] = useState<ScoreView | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const cfg = NETWORKS[net];

  const provider = useMemo(() => {
    if (!cfg.rpc) return null;
    return new JsonRpcProvider(cfg.rpc, cfg.chainId);
  }, [cfg]);

  async function getScore() {
    try {
      setLoading(true);
      setValid(null);
      setScore(null);

      if (!provider) throw new Error("Missing RPC for " + cfg.name);
      if (!isAddress(addr)) throw new Error("Enter a valid 0x address");
      if (!isAddress(cfg.scorer)) throw new Error("Scorer not configured");

      const c = new Contract(cfg.scorer, OCCR_ABI, provider);

      // adjust this line if your calculateRiskScore returns only (uint256)
      const res = await c.calculateRiskScore(getAddress(addr));
      // If tuple: [score, tier, lastUpdated, algorithmId]
      let sv: ScoreView;
      if (Array.isArray(res)) {
        sv = {
          score: Number(res[0]),
          tier: fmtTier(Number(res[1])),
          lastUpdated: Number(res[2]),
          algorithmId: String(res[3]),
        };
      } else {
        sv = { score: Number(res), tier: "?" };
      }
      setScore(sv);
    } catch (e: any) {
      alert(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function doValidate() {
    try {
      setLoading(true);
      setValid(null);

      if (!provider) throw new Error("Missing RPC for " + cfg.name);
      if (!isAddress(addr)) throw new Error("Enter a valid 0x address");
      if (!isAddress(cfg.scorer)) throw new Error("Scorer not configured");

      const c = new Contract(cfg.scorer, OCCR_ABI, provider);
      const ok: boolean = await c.validateScore(getAddress(addr), Number(minScore));
      setValid(ok);
    } catch (e: any) {
      alert(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "40px auto", fontFamily: "Inter, system-ui" }}>
      <h1>OCCR Multi-Chain Demo</h1>
      <p style={{ color: "#666" }}>
        Query your on-chain credit score on Ethereum Sepolia, RSK Testnet, or Hedera Testnet.
      </p>

      <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
        <label>
          Network:&nbsp;
          <select value={net} onChange={(e) => setNet(e.target.value as NetKey)}>
            <option value="sepolia">Sepolia</option>
            <option value="rsk">RSK Testnet</option>
            <option value="hedera">Hedera Testnet</option>
          </select>
        </label>

        <label>
          Address:&nbsp;
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="0x..."
            style={{ width: "100%" }}
          />
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={getScore} disabled={loading}>
            {loading ? "Loading..." : "Get My Credit Score"}
          </button>

          <input
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
            style={{ width: 120 }}
            type="number"
            min={0}
            max={1000}
          />
          <button onClick={doValidate} disabled={loading}>
            Validate &ge; minScore
          </button>
        </div>

        {score && (
          <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <div><b>Score:</b> {score.score} / 1000</div>
            <div><b>Tier:</b> {score.tier}</div>
            {score.lastUpdated ? (
              <div><b>Last updated:</b> {new Date(score.lastUpdated * 1000).toLocaleString()}</div>
            ) : null}
            {score.algorithmId ? (
              <div><b>Algo:</b> {score.algorithmId}</div>
            ) : null}
          </div>
        )}

        {valid !== null && (
          <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <b>validateScore:</b> {String(valid)}
          </div>
        )}

        <small style={{ color: "#888" }}>
          RPC: {cfg.rpc ? "configured" : "missing"} • Scorer: {cfg.scorer || "(missing)"}
        </small>
      </div>
    </div>
  );
}
