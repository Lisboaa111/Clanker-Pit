import { TileType, Tile } from './types'

interface Node {
  x: number
  z: number
  g: number
  h: number
  f: number
  parent: Node | null
}

function heuristic(ax: number, az: number, bx: number, bz: number): number {
  return Math.abs(ax - bx) + Math.abs(az - bz)
}

function key(x: number, z: number): string {
  return `${x},${z}`
}

/**
 * A* pathfinding on the tile grid.
 * @param map      - 2D array [z][x] of Tile
 * @param sx, sz   - start tile
 * @param ex, ez   - end tile
 * @param canWalkOnResource - if true, resource tiles (TREE, GOLD_MINE) are walkable
 * @returns array of {x,z} steps from start (exclusive) to end (inclusive), or [] if no path
 */
export function findPath(
  map: Tile[][],
  sx: number, sz: number,
  ex: number, ez: number,
  canWalkOnResource = false,
): Array<{ x: number; z: number }> {
  const mapH = map.length
  const mapW = map[0].length

  // Clamp destination
  ex = Math.max(0, Math.min(mapW - 1, ex))
  ez = Math.max(0, Math.min(mapH - 1, ez))

  if (sx === ex && sz === ez) return []

  const isWalkable = (x: number, z: number): boolean => {
    if (x < 0 || z < 0 || x >= mapW || z >= mapH) return false
    const t = map[z][x].type
    if (t === TileType.WATER) return false
    if (!canWalkOnResource && (t === TileType.TREE || t === TileType.GOLD_MINE)) return false
    return true
  }

  // If destination isn't walkable, find nearest walkable neighbour
  if (!isWalkable(ex, ez)) {
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]
    let found = false
    for (const [dx, dz] of dirs) {
      if (isWalkable(ex + dx, ez + dz)) {
        ex = ex + dx
        ez = ez + dz
        found = true
        break
      }
    }
    if (!found) return []
  }

  const open: Map<string, Node> = new Map()
  const closed: Set<string> = new Set()

  const startNode: Node = { x: sx, z: sz, g: 0, h: heuristic(sx, sz, ex, ez), f: 0, parent: null }
  startNode.f = startNode.g + startNode.h
  open.set(key(sx, sz), startNode)

  const dirs4 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]

  while (open.size > 0) {
    // find lowest f
    let current: Node | null = null
    for (const node of open.values()) {
      if (!current || node.f < current.f) current = node
    }
    if (!current) break

    if (current.x === ex && current.z === ez) {
      // reconstruct path
      const path: Array<{ x: number; z: number }> = []
      let n: Node | null = current
      while (n && !(n.x === sx && n.z === sz)) {
        path.unshift({ x: n.x, z: n.z })
        n = n.parent
      }
      return path
    }

    open.delete(key(current.x, current.z))
    closed.add(key(current.x, current.z))

    for (const [dx, dz] of dirs4) {
      const nx = current.x + dx
      const nz = current.z + dz
      const nk = key(nx, nz)
      if (closed.has(nk)) continue
      if (!isWalkable(nx, nz)) continue

      const isDiag = dx !== 0 && dz !== 0
      const stepCost = isDiag ? 1.414 : 1
      const g = current.g + stepCost
      const h = heuristic(nx, nz, ex, ez)
      const f = g + h

      const existing = open.get(nk)
      if (existing && existing.g <= g) continue

      open.set(nk, { x: nx, z: nz, g, h, f, parent: current })
    }

    // Safety cap to avoid freezing on huge maps
    if (closed.size > 4000) break
  }

  return []
}

/** Convert tile coords to world (center of tile) */
export function tileToWorld(tileX: number, tileZ: number, tileSize: number): { x: number; z: number } {
  return {
    x: tileX * tileSize + tileSize / 2,
    z: tileZ * tileSize + tileSize / 2,
  }
}

/** Convert world position to tile coords */
export function worldToTile(wx: number, wz: number, tileSize: number): { x: number; z: number } {
  return {
    x: Math.floor(wx / tileSize),
    z: Math.floor(wz / tileSize),
  }
}
