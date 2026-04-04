import { Tile, TileType } from './types'
import { MAP_WIDTH, MAP_HEIGHT } from './constants'

/**
 * Returns the nearest GRASS tile that borders a resource/building cluster.
 *
 * Unlike a simple 8-neighbour check, this BFS walks INWARD through the
 * resource cluster so it works for forest-interior trees: a tree in the
 * middle of a 16-tile patch has no grass neighbours itself, but the BFS
 * fans outward through adjacent tree tiles until it reaches the forest edge.
 *
 * Workers stand at the returned tile to interact; they never walk onto the
 * resource tile itself.
 */
export function adjacentGrassTile(
  map: Tile[][],
  resX: number,
  resZ: number,
): { x: number; z: number } {
  const dirs8: Array<[number, number]> = [
    [0, -1], [1, 0], [0, 1], [-1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ]

  // BFS from the resource tile outward through any non-GRASS tile.
  // The first GRASS tile we encounter is the nearest forest-edge standing spot.
  const queue: Array<{ x: number; z: number }> = [{ x: resX, z: resZ }]
  const visited = new Set<string>()
  visited.add(`${resX},${resZ}`)

  while (queue.length > 0) {
    const { x, z } = queue.shift()!

    for (const [dx, dz] of dirs8) {
      const nx = x + dx
      const nz = z + dz
      if (nx < 0 || nz < 0 || nx >= MAP_WIDTH || nz >= MAP_HEIGHT) continue
      const k = `${nx},${nz}`
      if (visited.has(k)) continue
      visited.add(k)

      if (map[nz][nx].type === TileType.GRASS) return { x: nx, z: nz }

      // Expand through non-GRASS tiles (trees/mines) so we can cross a
      // thick forest. Don't expand through water — it's a hard barrier.
      if (map[nz][nx].type !== TileType.WATER) {
        queue.push({ x: nx, z: nz })
      }
    }

    // Safety cap: a 48×48 map has 2304 tiles; 400 is enough for any patch.
    if (visited.size > 400) break
  }

  // Absolute fallback — resource surrounded entirely by water/map-edge.
  return { x: resX, z: resZ }
}
