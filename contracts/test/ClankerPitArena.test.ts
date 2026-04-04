import { expect } from 'chai'
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { ClankerPitArena } from '../typechain-types'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'

// ── Fixture ────────────────────────────────────────────────────────────────────
async function deployFixture() {
  const [owner, agent0, agent1, outsider] = await ethers.getSigners()
  const Arena = await ethers.getContractFactory('ClankerPitArena')
  const arena = (await Arena.deploy()) as unknown as ClankerPitArena
  await arena.waitForDeployment()

  // Canonical matchId for tests
  const matchId = ethers.encodeBytes32String('match-001')

  const ENTRY = ethers.parseEther('0.01')  // 0.01 ETH per slot

  return { arena, owner, agent0, agent1, outsider, matchId, ENTRY }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
/**
 * Platform (owner) calls deposit on behalf of an agent.
 * depositorAddr is the agent's wallet — receives the payout on settle / refund.
 */
async function deposit(
  arena: ClankerPitArena,
  owner: HardhatEthersSigner,
  matchId: string,
  slot: 0 | 1,
  amount: bigint,
  depositorAddr: string,
) {
  return arena.connect(owner).deposit(matchId, slot, depositorAddr, { value: amount })
}

// ── Tests ──────────────────────────────────────────────────────────────────────
describe('ClankerPitArena', () => {
  // ── Deployment ───────────────────────────────────────────────────────────────
  describe('deployment', () => {
    it('sets the deployer as owner', async () => {
      const { arena, owner } = await loadFixture(deployFixture)
      expect(await arena.owner()).to.equal(owner.address)
    })

    it('platform fee is 500 bps (5%)', async () => {
      const { arena } = await loadFixture(deployFixture)
      expect(await arena.PLATFORM_FEE_BPS()).to.equal(500n)
    })
  })

  // ── deposit ───────────────────────────────────────────────────────────────────
  describe('deposit', () => {
    it('accepts deposits for both slots', async () => {
      const { arena, owner, agent0, agent1, matchId, ENTRY } = await loadFixture(deployFixture)

      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await deposit(arena, owner, matchId, 1, ENTRY, agent1.address)

      // Contract should hold both deposits
      const arenaBalance = await ethers.provider.getBalance(await arena.getAddress())
      expect(arenaBalance).to.equal(ENTRY * 2n)

      // Match is not yet settled or refunded
      const m = await arena.getMatch(matchId)
      expect(m.settled).to.be.false
      expect(m.refunded).to.be.false
    })

    it('emits Deposited event with depositorAddr', async () => {
      const { arena, owner, agent0, matchId, ENTRY } = await loadFixture(deployFixture)
      await expect(deposit(arena, owner, matchId, 0, ENTRY, agent0.address))
        .to.emit(arena, 'Deposited')
        .withArgs(matchId, agent0.address, ENTRY, 0)
    })

    it('rejects duplicate slot', async () => {
      const { arena, owner, agent0, agent1, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await expect(deposit(arena, owner, matchId, 0, ENTRY, agent1.address))
        .to.be.revertedWithCustomError(arena, 'SlotTaken')
    })

    it('rejects invalid slot number', async () => {
      const { arena, owner, agent0, matchId, ENTRY } = await loadFixture(deployFixture)
      await expect(deposit(arena, owner, matchId, 2 as 0 | 1, ENTRY, agent0.address))
        .to.be.revertedWithCustomError(arena, 'InvalidSlot')
    })

    it('rejects deposit from non-owner', async () => {
      const { arena, agent0, matchId, ENTRY } = await loadFixture(deployFixture)
      await expect(arena.connect(agent0).deposit(matchId, 0, agent0.address, { value: ENTRY }))
        .to.be.revertedWithCustomError(arena, 'NotOwner')
    })

    it('rejects deposit on a settled match', async () => {
      const { arena, owner, agent0, agent1, outsider, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await deposit(arena, owner, matchId, 1, ENTRY, agent1.address)
      await arena.connect(owner).settle(matchId, agent0.address)

      await expect(deposit(arena, owner, matchId, 0, ENTRY, outsider.address))
        .to.be.revertedWithCustomError(arena, 'AlreadySettled')
    })

    it('rejects deposit on a refunded match', async () => {
      const { arena, owner, agent0, outsider, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await arena.connect(owner).refund(matchId)

      await expect(deposit(arena, owner, matchId, 0, ENTRY, outsider.address))
        .to.be.revertedWithCustomError(arena, 'AlreadyRefunded')
    })
  })

  // ── settle ────────────────────────────────────────────────────────────────────
  describe('settle', () => {
    it('pays 95% to winner, 5% to owner', async () => {
      const { arena, owner, agent0, agent1, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await deposit(arena, owner, matchId, 1, ENTRY, agent1.address)

      const pool     = ENTRY * 2n
      const fee      = pool * 500n / 10_000n
      const payout   = pool - fee

      const ownerBefore  = await ethers.provider.getBalance(owner.address)
      const winnerBefore = await ethers.provider.getBalance(agent0.address)

      const tx      = await arena.connect(owner).settle(matchId, agent0.address)
      const receipt = await tx.wait()
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice

      const ownerAfter  = await ethers.provider.getBalance(owner.address)
      const winnerAfter = await ethers.provider.getBalance(agent0.address)

      expect(winnerAfter - winnerBefore).to.equal(payout)
      // owner receives fee minus gas
      expect(ownerAfter - ownerBefore + gasUsed).to.equal(fee)
    })

    it('emits Settled event', async () => {
      const { arena, owner, agent0, agent1, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await deposit(arena, owner, matchId, 1, ENTRY, agent1.address)

      const pool   = ENTRY * 2n
      const fee    = pool * 500n / 10_000n
      const payout = pool - fee

      await expect(arena.connect(owner).settle(matchId, agent0.address))
        .to.emit(arena, 'Settled')
        .withArgs(matchId, agent0.address, payout, fee)
    })

    it('allows agent1 to win', async () => {
      const { arena, owner, agent0, agent1, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await deposit(arena, owner, matchId, 1, ENTRY, agent1.address)

      const pool   = ENTRY * 2n
      const payout = pool - pool * 500n / 10_000n

      const before = await ethers.provider.getBalance(agent1.address)
      await arena.connect(owner).settle(matchId, agent1.address)
      const after  = await ethers.provider.getBalance(agent1.address)

      expect(after - before).to.equal(payout)
    })

    it('rejects non-owner settle', async () => {
      const { arena, owner, agent0, agent1, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await deposit(arena, owner, matchId, 1, ENTRY, agent1.address)

      await expect(arena.connect(agent0).settle(matchId, agent0.address))
        .to.be.revertedWithCustomError(arena, 'NotOwner')
    })

    it('rejects winner not a participant', async () => {
      const { arena, owner, agent0, agent1, outsider, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await deposit(arena, owner, matchId, 1, ENTRY, agent1.address)

      await expect(arena.connect(owner).settle(matchId, outsider.address))
        .to.be.revertedWith('winner not a participant')
    })

    it('rejects double-settle', async () => {
      const { arena, owner, agent0, agent1, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await deposit(arena, owner, matchId, 1, ENTRY, agent1.address)
      await arena.connect(owner).settle(matchId, agent0.address)

      await expect(arena.connect(owner).settle(matchId, agent0.address))
        .to.be.revertedWithCustomError(arena, 'AlreadySettled')
    })

    it('rejects settle on refunded match', async () => {
      const { arena, owner, agent0, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await arena.connect(owner).refund(matchId)

      await expect(arena.connect(owner).settle(matchId, agent0.address))
        .to.be.revertedWithCustomError(arena, 'AlreadyRefunded')
    })

    it('rejects settle with no deposits', async () => {
      const { arena, owner, agent0, matchId } = await loadFixture(deployFixture)
      await expect(arena.connect(owner).settle(matchId, agent0.address))
        .to.be.revertedWith('winner not a participant')
    })
  })

  // ── refund ────────────────────────────────────────────────────────────────────
  describe('refund', () => {
    it('returns deposits to both participants', async () => {
      const { arena, owner, agent0, agent1, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await deposit(arena, owner, matchId, 1, ENTRY, agent1.address)

      const b0Before = await ethers.provider.getBalance(agent0.address)
      const b1Before = await ethers.provider.getBalance(agent1.address)

      await arena.connect(owner).refund(matchId)

      const b0After = await ethers.provider.getBalance(agent0.address)
      const b1After = await ethers.provider.getBalance(agent1.address)

      expect(b0After - b0Before).to.equal(ENTRY)
      expect(b1After - b1Before).to.equal(ENTRY)
    })

    it('emits Refunded event', async () => {
      const { arena, owner, agent0, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)

      await expect(arena.connect(owner).refund(matchId))
        .to.emit(arena, 'Refunded')
        .withArgs(matchId)
    })

    it('refunds partial deposit (only one slot filled)', async () => {
      const { arena, owner, agent0, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)

      const before = await ethers.provider.getBalance(agent0.address)
      await arena.connect(owner).refund(matchId)
      const after  = await ethers.provider.getBalance(agent0.address)

      expect(after - before).to.equal(ENTRY)
    })

    it('rejects non-owner refund', async () => {
      const { arena, owner, agent0, agent1, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await deposit(arena, owner, matchId, 1, ENTRY, agent1.address)

      await expect(arena.connect(agent0).refund(matchId))
        .to.be.revertedWithCustomError(arena, 'NotOwner')
    })

    it('rejects double-refund', async () => {
      const { arena, owner, agent0, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await arena.connect(owner).refund(matchId)

      await expect(arena.connect(owner).refund(matchId))
        .to.be.revertedWithCustomError(arena, 'AlreadyRefunded')
    })

    it('rejects refund on settled match', async () => {
      const { arena, owner, agent0, agent1, matchId, ENTRY } = await loadFixture(deployFixture)
      await deposit(arena, owner, matchId, 0, ENTRY, agent0.address)
      await deposit(arena, owner, matchId, 1, ENTRY, agent1.address)
      await arena.connect(owner).settle(matchId, agent0.address)

      await expect(arena.connect(owner).refund(matchId))
        .to.be.revertedWithCustomError(arena, 'AlreadySettled')
    })
  })

  // ── multiple matches ──────────────────────────────────────────────────────────
  describe('multiple independent matches', () => {
    it('two matches can run simultaneously', async () => {
      const { arena, owner, agent0, agent1, ENTRY } = await loadFixture(deployFixture)
      const m1 = ethers.encodeBytes32String('match-A')
      const m2 = ethers.encodeBytes32String('match-B')

      await deposit(arena, owner, m1, 0, ENTRY, agent0.address)
      await deposit(arena, owner, m1, 1, ENTRY, agent1.address)
      await deposit(arena, owner, m2, 0, ENTRY, agent0.address)
      await deposit(arena, owner, m2, 1, ENTRY, agent1.address)

      // Settle m1 → agent0 wins, settle m2 → agent1 wins
      await arena.connect(owner).settle(m1, agent0.address)
      await arena.connect(owner).settle(m2, agent1.address)

      const r1 = await arena.getMatch(m1)
      const r2 = await arena.getMatch(m2)
      expect(r1.settled).to.be.true
      expect(r2.settled).to.be.true
    })
  })
})
