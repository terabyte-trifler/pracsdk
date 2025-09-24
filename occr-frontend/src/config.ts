export const NETWORKS = {
    sepolia: {
      name: "Sepolia",
      rpc: import.meta.env.VITE_SEPOLIA_RPC || "",
      scorer: import.meta.env.VITE_SCORER_SEPOLIA || "",
      chainId: 11155111,
    },
    rsk: {
      name: "RSK Testnet",
      rpc: import.meta.env.VITE_RSK_TESTNET_RPC || "",
      scorer: import.meta.env.VITE_SCORER_RSK || "",
      chainId: 31,
    },
    hedera: {
      name: "Hedera Testnet",
      rpc: import.meta.env.VITE_HEDERA_EVM_RPC || "",
      scorer: import.meta.env.VITE_SCORER_HEDERA || "",
      chainId: 296,
    },
  } as const;
  
  export type NetKey = keyof typeof NETWORKS;
  