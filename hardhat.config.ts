import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const SEPOLIA_RPC = process.env.SEPOLIA_RPC || "";
const RSK_TESTNET_RPC = process.env.RSK_TESTNET_RPC || ""; // Rootstock Testnet
const HEDERA_EVM_RPC = process.env.HEDERA_EVM_RPC || "";   // Hedera EVM testnet RPC (e.g., "https://testnet.hashio.io/api")

const PK = process.env.PRIVATE_KEY || "0x"+"1".repeat(64);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: {},
    sepolia: {
      url: SEPOLIA_RPC,
      accounts: [PK],
    },
    rskTestnet: {
      url: RSK_TESTNET_RPC,
      accounts: [PK],
      chainId: 31,
      gasPrice: 100000000, // tune if needed
    },
    hederaTestnet: {
      url: HEDERA_EVM_RPC,
      accounts: [PK],
    },
  },
  etherscan: {
    // optional: add api keys if you want verify
    // apiKey: { sepolia: process.env.ETHERSCAN_KEY || "" }
  },
};

export default config;
