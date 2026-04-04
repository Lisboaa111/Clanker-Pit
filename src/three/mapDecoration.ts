import * as THREE from 'three'
import { SurvivalKitAssets, cloneSK } from './survivalKitLoader'
import { Tile, TileType } from '../game/types'
import { TILE_SIZE } from '../game/constants'

// Keep rocks/grass away from player spawn zones
const AVOID_ZONES = [
  { x0: 1, z0: 1, x1: 16, z1: 14 },   // P0 base
  { x0: 27, z0: 32, x1: 45, z1: 45 }, // P1 base
]

function inAvoid(tx: number, tz: number): boolean {
  return AVOID_ZONES.some(a => tx >= a.x0 && tx <= a.x1 && tz >= a.z0 && tz <= a.z1)
}

/**
 * Scatter rocks, grass patches and campfires across the map.
 * Call AFTER initGameState so it doesn't interfere with tile raycasting.
 */
export function scatterMapDecoration(
  scene: THREE.Scene,
  map: Tile[][],
  sk: SurvivalKitAssets,
): void {
  const rocks = (['rock-a', 'rock-b', 'rock-c'] as const)

  for (let z = 0; z < map.length; z++) {
    for (let x = 0; x < map[z].length; x++) {
      const tile = map[z][x]
      if (tile.type !== TileType.GRASS) continue
      if (inAvoid(x, z)) continue

      const rng = Math.random()
      const cx = x * TILE_SIZE + TILE_SIZE / 2
      const cz = z * TILE_SIZE + TILE_SIZE / 2

      if (rng < 0.055) {
        // ── Rock ────────────────────────────────────────────────────────────
        const key = rocks[Math.floor(Math.random() * rocks.length)]
        const obj = cloneSK(sk[key])
        obj.scale.setScalar(0.45 + Math.random() * 0.65)
        obj.rotation.y = Math.random() * Math.PI * 2
        obj.position.set(
          cx + (Math.random() - 0.5) * 0.9,
          0,
          cz + (Math.random() - 0.5) * 0.9,
        )
        scene.add(obj)

      } else if (rng < 0.085) {
        // ── Grass tuft ───────────────────────────────────────────────────────
        const obj = cloneSK(sk['grass-large'])
        obj.scale.setScalar(0.55 + Math.random() * 0.45)
        obj.rotation.y = Math.random() * Math.PI * 2
        obj.position.set(
          cx + (Math.random() - 0.5) * 0.7,
          0,
          cz + (Math.random() - 0.5) * 0.7,
        )
        scene.add(obj)
      }
    }
  }

  // ── Campfires near each base ─────────────────────────────────────────────
  const campSpots = [
    { tx: 9,  tz: 10 }, { tx: 11, tz: 9  },  // P0
    { tx: 36, tz: 36 }, { tx: 34, tz: 37 },  // P1
  ]
  for (const { tx, tz } of campSpots) {
    const fire = cloneSK(sk['campfire-stand'])
    fire.scale.setScalar(0.65)
    fire.rotation.y = Math.random() * Math.PI * 2
    fire.position.set(
      tx * TILE_SIZE + TILE_SIZE / 2,
      0,
      tz * TILE_SIZE + TILE_SIZE / 2,
    )
    scene.add(fire)
  }
}
