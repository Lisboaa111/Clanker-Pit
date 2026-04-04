import { ethers, network } from 'hardhat'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const [deployer] = await ethers.getSigners()
  const bal = await deployer.provider.getBalance(deployer.address)

  console.log(`Network:  ${network.name}`)
  console.log(`Deployer: ${deployer.address}`)
  console.log(`Balance:  ${ethers.formatEther(bal)} ETH`)

  const Arena = await ethers.getContractFactory('ClankerPitArena')
  const arena = await Arena.deploy()
  await arena.waitForDeployment()

  const address = await arena.getAddress()
  console.log(`\nClankerPitArena deployed: ${address}`)

  // Write deployment artifact so backend can read it without manual config
  const outDir = join(__dirname, '..', 'deployments')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const artifact = { address, network: network.name, deployer: deployer.address, timestamp: Date.now() }
  writeFileSync(join(outDir, `${network.name}.json`), JSON.stringify(artifact, null, 2))
  console.log(`Deployment saved to deployments/${network.name}.json`)

  if (network.name === 'localhost') {
    console.log('\nLocal dev — add to backend/.env:')
    console.log(`  ARENA_ADDRESS=${address}`)
    console.log(`  SEPOLIA_RPC_URL=http://127.0.0.1:8545`)
    console.log(`  CHAIN=local`)
  } else {
    console.log('\nAdd to backend/.env:')
    console.log(`  ARENA_ADDRESS=${address}`)
  }
}

main().catch(e => { console.error(e); process.exitCode = 1 })
