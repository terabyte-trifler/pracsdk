// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRiskScorer {
    /// @notice Returns latest composite score, tier, algorithmId, and lastUpdated timestamp.
    /// Score is 0–1000, Tier is A=0..D=3.
    /// If stale/never updated, returns (0, 3, algorithmId, 0).
    function calculateRiskScore(address user)
        external
        view
        returns (
            uint256 score,
            uint8 tier,
            bytes32 algorithmId,
            uint256 lastUpdated
        );

    /// @notice Admin-updated model parameters (abi-encoded)
    function updateRiskParameters(bytes calldata params) external;

    /// @notice Validates user's score against a minimum
    function validateScore(address user, uint256 minScore) external view returns (bool);
}
