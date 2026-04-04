import * as THREE from 'three'
import { Tile, TileType } from './types'
import {
  MAP_WIDTH, MAP_HEIGHT, TILE_SIZE,
  WATER_THRESHOLD, NOISE_SCALE,
  FOREST_PATCH_COUNT, FOREST_PATCH_SIZE_MIN, FOREST_PATCH_SIZE_MAX,
  GOLD_MINE_COUNT,
  COLOR_GRASS, COLOR_GRASS_DARK, COLOR_WATER, COLOR_WATER_FOAM,
  COLOR_TREE, COLOR_GOLD_MINE,
} from './constants'

// ── Simple noise (no deps) ────────────────────────────────────────────────────
// Permutation-based smooth noise
function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10) }
function lerp(a: number, b: number, t: number) { return a + t * (b - a) }
function grad(hash: number, x: number, y: number): number {
  const h = hash & 3
  const u = h < 2 ? x : y
  const v = h < 2 ? y : x
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v)
}

const perm = (() => {
  const p = Array.from({ length: 256 }, (_, i) => i)
  // deterministic shuffle (seed = 42)
  let seed = 42
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff
    const j = Math.abs(seed) % (i + 1);
    [p[i], p[j]] = [p[j], p[i]]
  }
  return [...p, ...p]
})()

function noise2d(x: number, y: number): number {
  const X = Math.floor(x) & 255
  const Y = Math.floor(y) & 255
  x -= Math.floor(x)
  y -= Math.floor(y)
  const u = fade(x), v = fade(y)
  const a = perm[X] + Y, b = perm[X + 1] + Y
  return lerp(
    lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u),
    lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u),
    v,
  )
}

function noise(x: number, y: number): number {
  // normalise from [-1,1] to [0,1]
  return (noise2d(x, y) + 1) / 2
}

// ── Tile mesh factories ───────────────────────────────────────────────────────
const groundGeo = new THREE.BoxGeometry(TILE_SIZE, 0.15, TILE_SIZE)
const waterGeo  = new THREE.BoxGeometry(TILE_SIZE, 0.05, TILE_SIZE)

const grassMat  = new THREE.MeshLambertMaterial({ color: COLOR_GRASS })
const grassDMat = new THREE.MeshLambertMaterial({ color: COLOR_GRASS_DARK })
const waterMat  = new THREE.MeshLambertMaterial({ color: COLOR_WATER })
const waterFMat = new THREE.MeshLambertMaterial({ color: COLOR_WATER_FOAM })

function makeTileMesh(type: TileType, x: number, z: number): THREE.Mesh {
  let geo: THREE.BufferGeometry
  let mat: THREE.MeshLambertMaterial

  if (type === TileType.WATER) {
    geo = waterGeo
    // Water tiles never change — sharing is safe
    mat = (x + z) % 2 === 0 ? waterMat : waterFMat
  } else {
    geo = groundGeo
    // MUST clone: grass/tree/mine tiles mutate their material color independently.
    // Sharing a single grassMat means any setTileType call corrupts ALL grass tiles.
    mat = ((x + z) % 2 === 0 ? grassMat : grassDMat).clone()
  }

  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(
    x * TILE_SIZE + TILE_SIZE / 2,
    type === TileType.WATER ? -0.05 : 0,
    z * TILE_SIZE + TILE_SIZE / 2,
  )
  mesh.receiveShadow = true
  mesh.userData = { tileX: x, tileZ: z, tileType: type }
  return mesh
}

// ── Map generation ────────────────────────────────────────────────────────────
export function generateMap(scene: THREE.Scene): Tile[][] {
  // 1. Init grid from noise
  const map: Tile[][] = Array.from({ length: MAP_HEIGHT }, (_, z) =>
    Array.from({ length: MAP_WIDTH }, (_, x) => {
      const n = noise(x * NOISE_SCALE, z * NOISE_SCALE)
      const type = n < WATER_THRESHOLD ? TileType.WATER : TileType.GRASS
      const mesh = makeTileMesh(type, x, z)
      scene.add(mesh)
      return { type, x, z, mesh }
    })
  )

  // 2. Forest patches
  for (let p = 0; p < FOREST_PATCH_COUNT; p++) {
    const cx = Math.floor(Math.random() * MAP_WIDTH)
    const cz = Math.floor(Math.random() * MAP_HEIGHT)
    const patchW = FOREST_PATCH_SIZE_MIN + Math.floor(Math.random() * (FOREST_PATCH_SIZE_MAX - FOREST_PATCH_SIZE_MIN))
    const patchH = FOREST_PATCH_SIZE_MIN + Math.floor(Math.random() * (FOREST_PATCH_SIZE_MAX - FOREST_PATCH_SIZE_MIN))
    for (let dz = 0; dz < patchH; dz++) {
      for (let dx = 0; dx < patchW; dx++) {
        const tx = cx + dx
        const tz = cz + dz
        if (tx >= 0 && tx < MAP_WIDTH && tz >= 0 && tz < MAP_HEIGHT) {
          if (map[tz][tx].type === TileType.GRASS) {
            setTileType(map[tz][tx], TileType.TREE)
          }
        }
      }
    }
  }

  // 3. Gold mines (not on water or near town hall start)
  let minesPlaced = 0
  let attempts = 0
  while (minesPlaced < GOLD_MINE_COUNT && attempts < 1000) {
    attempts++
    const gx = 5 + Math.floor(Math.random() * (MAP_WIDTH - 10))
    const gz = 5 + Math.floor(Math.random() * (MAP_HEIGHT - 10))
    const tile = map[gz][gx]
    if (tile.type === TileType.GRASS || tile.type === TileType.TREE) {
      // Keep away from spawn area (top-left)
      if (gx < 15 && gz < 15) continue
      setTileType(tile, TileType.GOLD_MINE)
      minesPlaced++
    }
  }

  // 4. Clear spawn areas — must cover town hall + all 5 worker spawn tiles + buffer
  // P0 hall=(6,6), workers=(8..12, 7)  → clear x:2..14  z:2..12
  // P1 hall=(38,38), workers=(32..36, 37) → clear x:29..43  z:34..43
  clearRect(map, 2, 2, 14, 12)
  clearRect(map, 29, 34, 43, 43)

  return map
}

function clearRect(map: Tile[][], x0: number, z0: number, x1: number, z1: number) {
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const tile = map[z]?.[x]
      if (tile && tile.type !== TileType.GRASS) setTileType(tile, TileType.GRASS)
    }
  }
}

function setTileType(tile: Tile, type: TileType) {
  tile.type = type
  // Update mesh color
  const mat = tile.mesh.material as THREE.MeshLambertMaterial
  if (type === TileType.TREE) {
    mat.color.setHex(COLOR_TREE)
  } else if (type === TileType.GOLD_MINE) {
    mat.color.setHex(COLOR_GOLD_MINE)
  } else if (type === TileType.GRASS) {
    mat.color.setHex((tile.x + tile.z) % 2 === 0 ? COLOR_GRASS : COLOR_GRASS_DARK)
  }
  tile.mesh.userData.tileType = type
}
