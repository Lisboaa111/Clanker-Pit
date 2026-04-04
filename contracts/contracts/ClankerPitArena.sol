// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ClankerPitArena — agent registry + wager escrow.
 *
 * Payment flow:
 *   1. Agents pay registration fee + wager via x402 (HTTP 402) to the platform wallet.
 *   2. Platform calls registerAgent() and deposit() on their behalf, forwarding ETH.
 *   3. On game-over, platform calls settle(matchId, winnerAddr).
 *      Winner (the depositorAddr, i.e. the agent wallet) receives 95% of the pool.
 *      Platform receives the 5% fee.
 *   4. Cancelled matches: platform calls refund(), ETH returns to agent wallets.
 */
contract ClankerPitArena {
    address public immutable owner;
    uint256 public constant PLATFORM_FEE_BPS = 500;         // 5 %
    uint256 public constant REGISTRATION_FEE = 0.001 ether;

    struct Match {
        address[2] depositors;   // agent wallets (prize recipients)
        uint256[2] amounts;
        bool settled;
        bool refunded;
    }

    // agentId (keccak256 of agent string id) → agent wallet
    mapping(bytes32 => address) public agentOwner;

    // matchId (keccak256 of match UUID) → escrow state
    mapping(bytes32 => Match) public matches;

    event AgentRegistered(bytes32 indexed agentId, address indexed agentOwner);
    event Deposited(bytes32 indexed matchId, address indexed depositorAddr, uint256 amount, uint8 slot);
    event Settled(bytes32 indexed matchId, address indexed winner, uint256 payout, uint256 fee);
    event Refunded(bytes32 indexed matchId);

    error NotOwner();
    error AlreadySettled();
    error AlreadyRefunded();
    error SlotTaken();
    error NoDeposit();
    error InvalidSlot();
    error AgentAlreadyRegistered();
    error InsufficientFee();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ── Agent registry ────────────────────────────────────────────────────────

    /**
     * Register an agent permanently.
     * Platform calls this forwarding the agent's x402 registration fee.
     * agentOwnerAddr is the agent's wallet (used as prize recipient on settle).
     */
    function registerAgent(bytes32 agentId, address agentOwnerAddr) external payable onlyOwner {
        if (msg.value < REGISTRATION_FEE)       revert InsufficientFee();
        if (agentOwner[agentId] != address(0))  revert AgentAlreadyRegistered();
        agentOwner[agentId] = agentOwnerAddr;
        emit AgentRegistered(agentId, agentOwnerAddr);
    }

    // ── Match escrow ──────────────────────────────────────────────────────────

    /**
     * Explicit getter for the arrays inside a Match (the auto-generated public
     * mapping getter does not expose fixed-size array members via ABI).
     */
    function getMatch(bytes32 matchId) external view returns (
        address depositor0,
        address depositor1,
        uint256 amount0,
        uint256 amount1,
        bool    settled,
        bool    refunded
    ) {
        Match storage m = matches[matchId];
        return (m.depositors[0], m.depositors[1], m.amounts[0], m.amounts[1], m.settled, m.refunded);
    }

    /**
     * Platform locks a wager on behalf of an agent.
     * depositorAddr  = agent's wallet; this address receives the payout on settle / refund.
     * msg.sender     = platform (onlyOwner); it forwards the ETH it received via x402.
     */
    function deposit(bytes32 matchId, uint8 slot, address depositorAddr) external payable onlyOwner {
        if (slot > 1) revert InvalidSlot();
        Match storage m = matches[matchId];
        if (m.settled)  revert AlreadySettled();
        if (m.refunded) revert AlreadyRefunded();
        if (m.depositors[slot] != address(0)) revert SlotTaken();

        m.depositors[slot] = depositorAddr;
        m.amounts[slot]    = msg.value;

        emit Deposited(matchId, depositorAddr, msg.value, slot);
    }

    /**
     * Distribute pool to winner (95%) and platform (5%).
     * winner must equal one of the depositorAddr values set during deposit().
     */
    function settle(bytes32 matchId, address winner) external onlyOwner {
        Match storage m = matches[matchId];
        if (m.settled)  revert AlreadySettled();
        if (m.refunded) revert AlreadyRefunded();

        require(
            winner == m.depositors[0] || winner == m.depositors[1],
            "winner not a participant"
        );

        uint256 total = m.amounts[0] + m.amounts[1];
        if (total == 0) revert NoDeposit();

        m.settled = true;

        uint256 fee    = (total * PLATFORM_FEE_BPS) / 10_000;
        uint256 payout = total - fee;

        (bool ok1,) = winner.call{value: payout}("");
        require(ok1, "winner payout failed");

        (bool ok2,) = owner.call{value: fee}("");
        require(ok2, "fee transfer failed");

        emit Settled(matchId, winner, payout, fee);
    }

    /**
     * Refund both depositors (match cancelled before completion).
     * ETH goes to the depositorAddr values, not to the platform.
     */
    function refund(bytes32 matchId) external onlyOwner {
        Match storage m = matches[matchId];
        if (m.settled)  revert AlreadySettled();
        if (m.refunded) revert AlreadyRefunded();

        m.refunded = true;

        for (uint8 i = 0; i < 2; i++) {
            if (m.depositors[i] != address(0) && m.amounts[i] > 0) {
                (bool ok,) = m.depositors[i].call{value: m.amounts[i]}("");
                require(ok, "refund failed");
            }
        }

        emit Refunded(matchId);
    }

    receive() external payable {}
}
