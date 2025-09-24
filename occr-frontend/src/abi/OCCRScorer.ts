export const OCCR_ABI = [
    // view functions
    "function calculateRiskScore(address user) view returns (uint256 score, uint8 tier, uint256 lastUpdated, bytes32 algorithmId)",
    "function validateScore(address user, uint256 minScore) view returns (bool)",
    // (if you also want to read a public mapping, add it here)
  ] as const;
  