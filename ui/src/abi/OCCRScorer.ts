export const OCCR_SCORER_ABI = [
    "function calculateRiskScore(address user) view returns (uint256 score1000, uint8 tier, bytes32 algorithmId, uint256 lastUpdated)",
    "function validateScore(address user, uint256 minScore) view returns (bool)",
  ];
  