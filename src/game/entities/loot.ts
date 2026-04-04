import * as THREE from 'three'
import { LootPile, Worker, GameState, ResourceType, UnitType } from '../types'
import { makeLootPileMesh } from '../../three/meshes'
import { LOOT_COLLECT_RADIUS, LOOT_DESPAWN_TICKS, LOOT_SPIN_SPEED } from '../constants'

let lootUid = 0

export function createLootPile(
  x: number,
  z: number,
  type: ResourceType,
  amount: number,
  spawnTick: number,
  scene: THREE.Scene,
): LootPile {
  const mesh = makeLootPileMesh(type)
  mesh.position.set(x, 0, z)
  scene.add(mesh)
  return {
    id: `loot_${lootUid++}`,
    x,
    z,
    type,
    amount,
    mesh,
    spawnTick,
    rotation: 0,
  }
}

export function updateLootPiles(
  lootPiles: LootPile[],
  workers: Worker[],
  playerResources: GameState['playerResources'],
  dt: number,
  tick: number,
  scene: THREE.Scene,
): void {
  for (const loot of lootPiles) {
    if (loot.amount <= 0) continue

    // Spin + pulse animation
    loot.rotation += LOOT_SPIN_SPEED * dt
    loot.mesh.rotation.y = loot.rotation
    const pulse = 1.0 + 0.15 * Math.sin(loot.rotation * 2)
    loot.mesh.scale.setScalar(pulse)

    // Despawn after ~20 seconds
    if (tick - loot.spawnTick >= LOOT_DESPAWN_TICKS) {
      loot.amount = 0
      scene.remove(loot.mesh)
      continue
    }

    // Auto-collect: any living worker of any team within radius
    for (const w of workers) {
      if (w.dead || w.unitType !== UnitType.WORKER) continue
      const dx = w.x - loot.x
      const dz = w.z - loot.z
      if (Math.sqrt(dx * dx + dz * dz) <= LOOT_COLLECT_RADIUS) {
        const pr = playerResources[w.playerId]
        if (pr) {
          if (loot.type === ResourceType.GOLD) pr.gold += loot.amount
          else pr.lumber += loot.amount
        }
        loot.amount = 0
        scene.remove(loot.mesh)
        break
      }
    }
  }
}
