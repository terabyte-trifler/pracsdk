// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRiskScorer {
    /// @notice Returns latest composite score (0-1000) and tier (A=0..D=3)
    function calculateRiskScore(address user) external view returns (uint256 score, uint8 tier);

    /// @notice Admin-updated model parameters (abi-encoded)
    function updateRiskParameters(bytes calldata params) external;

    /// @notice Validates user's score against a minimum
    function validateScore(address user, uint256 minScore) external view returns (bool);
}
