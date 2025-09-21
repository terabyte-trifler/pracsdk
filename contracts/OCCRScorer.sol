// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IRiskScorer } from "./IRiskScorer.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title OCCRScorer (Day-1 skeleton)
/// @notice Stores scores, tiers, freshness; oracle-gated updates; parameters updatable by admin.
contract OCCRScorer is IRiskScorer, AccessControl {
    bytes32 public constant ADMIN_ROLE  = keccak256("ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    struct RiskProfile {
        uint32 score;       // 0..1000
        uint8  tier;        // 0..3 (A=0,B=1,C=2,D=3)
        uint64 lastUpdated; // unix seconds
        bytes32 algoId;     // which algorithm produced this score
    }

    // storage
    mapping(address => RiskProfile) private _profiles;

    // config
    uint64 public ttlSeconds = 24 hours;
    bytes   public modelParams;  // abi-encoded params (weights, cutoffs, priors, etc.)
    bytes32 public algorithmId;  // identifier for the current algorithm

    // events
    event ScoreUpdated(address indexed user, uint256 score, uint8 tier, bytes32 algoId);
    event TTLUpdated(uint64 ttl);
    event ParamsUpdated(bytes params, bytes32 algoId);

    constructor(address admin, address oracle, bytes32 algorithmId_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        if (oracle != address(0)) _grantRole(ORACLE_ROLE, oracle);
        algorithmId = algorithmId_;
    }

    // --- IRiskScorer ---
    function calculateRiskScore(address user) external view returns (uint256 score, uint8 tier) {
        RiskProfile memory p = _profiles[user];
        // stale => 0, D
        if (p.lastUpdated == 0 || block.timestamp > p.lastUpdated + ttlSeconds) {
            return (0, 3);
        }
        return (p.score, p.tier);
    }

    function updateRiskParameters(bytes calldata params) external onlyRole(ADMIN_ROLE) {
        modelParams = params;
        emit ParamsUpdated(params, algorithmId);
    }

    function validateScore(address user, uint256 minScore) external view returns (bool) {
        (uint256 s,) = this.calculateRiskScore(user);
        return s >= minScore;
    }

    // --- Admin ops ---
    function setTTL(uint64 newTtl) external onlyRole(ADMIN_ROLE) {
        ttlSeconds = newTtl;
        emit TTLUpdated(newTtl);
    }

    function setAlgorithmId(bytes32 algoId) external onlyRole(ADMIN_ROLE) {
        algorithmId = algoId;
    }

    // --- Oracle updater ---
    /// @notice Oracle pushes final computed score/tier (off-chain model).
    function updateScore(address user, uint256 newScore, uint8 newTier) external onlyRole(ORACLE_ROLE) {
        require(newScore <= 1000, "SCORE_RANGE");
        require(newTier <= 3, "TIER_RANGE");
        _profiles[user] = RiskProfile({
            score: uint32(newScore),
            tier: newTier,
            lastUpdated: uint64(block.timestamp),
            algoId: algorithmId
        });
        emit ScoreUpdated(user, newScore, newTier, algorithmId);
    }

    // --- Helpers ---
    function getProfile(address user) external view returns (RiskProfile memory) {
        return _profiles[user];
    }
}
