import * as THREE from 'three'
import {
  WORKER_SIZE, FOOTMAN_SIZE, ARCHER_SIZE,
  TREE_WIDTH, TREE_HEIGHT, GOLD_MINE_RADIUS, TOWN_HALL_SIZE, TILE_SIZE,
  COLOR_TREE, COLOR_TREE_TRUNK, COLOR_GOLD_MINE, COLOR_GOLD_DARK,
  COLOR_TOWN_HALL, COLOR_SELECTION, COLOR_PATH, COLOR_CARRY_GOLD, COLOR_CARRY_WOOD,
  PLAYER_COLORS, HP_BAR_WIDTH,
  TOWN_HALL_HP_BAR_WIDTH, BARRACKS_HP_BAR_WIDTH, FARM_HP_BAR_WIDTH, TOWER_HP_BAR_WIDTH,
} from '../game/constants'

// ── Shared geometries ─────────────────────────────────────────────────────────
const workerGeo       = new THREE.BoxGeometry(WORKER_SIZE, WORKER_SIZE, WORKER_SIZE)

const footmanBodyGeo  = new THREE.BoxGeometry(FOOTMAN_SIZE, FOOTMAN_SIZE * 1.4, FOOTMAN_SIZE)
const footmanSpikeGeo = new THREE.ConeGeometry(FOOTMAN_SIZE * 0.25, FOOTMAN_SIZE * 0.5, 4)

const archerBodyGeo   = new THREE.BoxGeometry(ARCHER_SIZE, ARCHER_SIZE * 1.3, ARCHER_SIZE)
const archerBowGeo    = new THREE.BoxGeometry(ARCHER_SIZE * 1.5, ARCHER_SIZE * 0.08, ARCHER_SIZE * 0.08)

const selectionGeo    = new THREE.RingGeometry(0.38, 0.5, 16)
const carryGeo        = new THREE.BoxGeometry(0.18, 0.18, 0.18)
const treeTrunkGeo    = new THREE.BoxGeometry(TREE_WIDTH * 0.4, TREE_HEIGHT * 0.5, TREE_WIDTH * 0.4)
const treeTopGeo      = new THREE.BoxGeometry(TREE_WIDTH, TREE_HEIGHT * 0.7, TREE_WIDTH)
const goldGeo         = new THREE.OctahedronGeometry(GOLD_MINE_RADIUS, 0)
const townHallGeo     = new THREE.BoxGeometry(TOWN_HALL_SIZE, TOWN_HALL_SIZE * 0.6, TOWN_HALL_SIZE)
const townRoofGeo     = new THREE.ConeGeometry(TOWN_HALL_SIZE * 0.75, TOWN_HALL_SIZE * 0.4, 4)

const hpBgGeo         = new THREE.BoxGeometry(HP_BAR_WIDTH, 0.05, 0.05)
const hpFillGeo       = new THREE.BoxGeometry(HP_BAR_WIDTH, 0.06, 0.06)

// Building HP bars (different widths)
const bldHpBgGeos: Record<number, THREE.BoxGeometry> = {}
const bldHpFillGeos: Record<number, THREE.BoxGeometry> = {}
function getBldHpGeo(width: number) {
  if (!bldHpBgGeos[width]) {
    bldHpBgGeos[width]   = new THREE.BoxGeometry(width, 0.12, 0.12)
    bldHpFillGeos[width] = new THREE.BoxGeometry(width, 0.14, 0.14)
  }
  return { bg: bldHpBgGeos[width], fill: bldHpFillGeos[width] }
}

// ── Materials ─────────────────────────────────────────────────────────────────
const selectionMat = new THREE.MeshBasicMaterial({ color: COLOR_SELECTION, side: THREE.DoubleSide })
const goldCarryMat = new THREE.MeshLambertMaterial({ color: COLOR_CARRY_GOLD })
const trunkMat     = new THREE.MeshLambertMaterial({ color: COLOR_TREE_TRUNK })
const treeMat      = new THREE.MeshLambertMaterial({ color: COLOR_TREE })
const goldMineMat  = new THREE.MeshLambertMaterial({ color: COLOR_GOLD_MINE })
const goldMineAlt  = new THREE.MeshLambertMaterial({ color: COLOR_GOLD_DARK })
const hpBgMat      = new THREE.MeshBasicMaterial({ color: 0x330000 })
const hpFillMat    = new THREE.MeshBasicMaterial({ color: 0x00cc44 })

// ── Worker mesh ───────────────────────────────────────────────────────────────
export function makeWorkerMesh(playerId: number): THREE.Mesh {
  const mat = new THREE.MeshLambertMaterial({ color: PLAYER_COLORS[playerId] ?? PLAYER_COLORS[0] })
  const mesh = new THREE.Mesh(workerGeo, mat)
  mesh.castShadow = true
  mesh.position.y = WORKER_SIZE / 2 + 0.08
  return mesh
}

// ── Footman mesh (heavy melee — taller with spike) ────────────────────────────
export function makeFootmanMesh(playerId: number): THREE.Mesh {
  const color = PLAYER_COLORS[playerId] ?? PLAYER_COLORS[0]
  const mat   = new THREE.MeshLambertMaterial({ color })
  const body  = new THREE.Mesh(footmanBodyGeo, mat)
  body.castShadow = true
  body.position.y = FOOTMAN_SIZE * 0.7 + 0.08

  const spikeMat = new THREE.MeshLambertMaterial({ color: Math.max(0, color - 0x222222) })
  const spike    = new THREE.Mesh(footmanSpikeGeo, spikeMat)
  spike.position.y = FOOTMAN_SIZE * 1.4 + FOOTMAN_SIZE * 0.25
  body.add(spike)
  return body
}

// ── Archer mesh (slim with horizontal bow) ────────────────────────────────────
export function makeArcherMesh(playerId: number): THREE.Mesh {
  const color = PLAYER_COLORS[playerId] ?? PLAYER_COLORS[0]
  // Lighter/brighter shade for archer
  const archerColor = blendColor(color, 0xffffff, 0.25)
  const mat  = new THREE.MeshLambertMaterial({ color: archerColor })
  const body = new THREE.Mesh(archerBodyGeo, mat)
  body.castShadow = true
  body.position.y = ARCHER_SIZE * 0.65 + 0.08

  // Bow: thin horizontal bar sticking out front
  const bowMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 })
  const bow    = new THREE.Mesh(archerBowGeo, bowMat)
  bow.position.set(0, ARCHER_SIZE * 0.3, ARCHER_SIZE * 0.55)
  body.add(bow)
  return body
}

// ── Selection ring ────────────────────────────────────────────────────────────
export function makeSelectionRing(playerId: number): THREE.Mesh {
  const mat = selectionMat.clone()
  mat.color.setHex(playerId === 0 ? 0xaaddff : 0xffaaaa)
  const ring = new THREE.Mesh(selectionGeo, mat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.09
  ring.visible = false
  return ring
}

// ── Carry indicator ───────────────────────────────────────────────────────────
export function makeCarryIndicator(): THREE.Mesh {
  const m = new THREE.Mesh(carryGeo, goldCarryMat.clone())
  m.position.y = WORKER_SIZE + 0.15
  m.visible = false
  return m
}

// ── Unit HP bar ───────────────────────────────────────────────────────────────
export function makeHealthBar(): { bg: THREE.Mesh; fill: THREE.Mesh } {
  const bg = new THREE.Mesh(hpBgGeo, hpBgMat.clone())
  bg.position.set(0, WORKER_SIZE + 0.28, 0.0)
  bg.rotation.x = -0.5

  const fill = new THREE.Mesh(hpFillGeo, hpFillMat.clone())
  fill.position.set(0, WORKER_SIZE + 0.29, 0.0)
  fill.rotation.x = -0.5
  return { bg, fill }
}

// ── Building HP bar ───────────────────────────────────────────────────────────
export function makeBuildingHealthBar(barWidth: number, yPos: number): { bg: THREE.Mesh; fill: THREE.Mesh } {
  const { bg: bgGeo, fill: fillGeo } = getBldHpGeo(barWidth)
  const bg   = new THREE.Mesh(bgGeo,   new THREE.MeshBasicMaterial({ color: 0x330000 }))
  const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: 0x00cc44 }))
  bg.position.set(0, yPos, 0)
  fill.position.set(0, yPos + 0.01, 0)
  return { bg, fill }
}

// ── Shared HP bar update (handles any bar width) ──────────────────────────────
export function updateHealthBarFill(fill: THREE.Mesh, ratio: number, barWidth = HP_BAR_WIDTH) {
  const r = Math.max(0.001, Math.min(1, ratio))
  fill.scale.x = r
  fill.position.x = -(1 - r) * barWidth / 2
  const mat = fill.material as THREE.MeshBasicMaterial
  if (r > 0.6)       mat.color.setHex(0x00cc44)
  else if (r > 0.3)  mat.color.setHex(0xddaa00)
  else               mat.color.setHex(0xdd2200)
}

// ── Resource meshes ───────────────────────────────────────────────────────────
export function makeTreeMesh(wx: number, wz: number): THREE.Group {
  const group = new THREE.Group()
  const trunk = new THREE.Mesh(treeTrunkGeo, trunkMat)
  trunk.position.y = TREE_HEIGHT * 0.25
  const top = new THREE.Mesh(treeTopGeo, treeMat)
  top.position.y = TREE_HEIGHT * 0.65
  group.add(trunk, top)
  group.position.set(wx, 0, wz)
  group.castShadow = true
  return group
}

export function makeGoldMineMesh(wx: number, wz: number): THREE.Group {
  const group = new THREE.Group()
  const base  = new THREE.Mesh(goldGeo, goldMineMat)
  base.position.y = GOLD_MINE_RADIUS * 0.8
  base.rotation.y = Math.PI / 4
  const inner = new THREE.Mesh(
    new THREE.OctahedronGeometry(GOLD_MINE_RADIUS * 0.5, 0),
    goldMineAlt,
  )
  inner.position.y = GOLD_MINE_RADIUS * 1.2
  group.add(base, inner)
  group.position.set(wx, 0, wz)
  group.castShadow = true
  return group
}

// ── Town Hall ─────────────────────────────────────────────────────────────────
export function makeTownHallMesh(wx: number, wz: number, playerId: number): THREE.Group {
  const group     = new THREE.Group()
  const bodyColor = playerId === 0 ? COLOR_TOWN_HALL : 0x7a3030
  const roofColor = playerId === 0 ? 0x6b4226 : 0x5a1a1a
  const body = new THREE.Mesh(townHallGeo, new THREE.MeshLambertMaterial({ color: bodyColor }))
  body.position.y = (TOWN_HALL_SIZE * 0.6) / 2
  const roof = new THREE.Mesh(townRoofGeo, new THREE.MeshLambertMaterial({ color: roofColor }))
  roof.position.y = TOWN_HALL_SIZE * 0.6 + TOWN_HALL_SIZE * 0.2
  roof.rotation.y = Math.PI / 4
  group.add(body, roof)
  group.position.set(wx, 0, wz)
  group.castShadow = true
  return group
}

// ── Barracks ──────────────────────────────────────────────────────────────────
export function makeBarracksMesh(wx: number, wz: number, playerId: number): THREE.Group {
  const group     = new THREE.Group()
  const bodyColor = playerId === 0 ? 0x2a3a6a : 0x6a1a1a
  const roofColor = playerId === 0 ? 0x1a2a5a : 0x4a0a0a
  // Main hall
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 1.0, 2.8),
    new THREE.MeshLambertMaterial({ color: bodyColor }),
  )
  body.position.y = 0.5
  // Flat roof / battlements
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.25, 3.2),
    new THREE.MeshLambertMaterial({ color: roofColor }),
  )
  roof.position.y = 1.1
  // Gate arch (darker box)
  const gate = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.8, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x111111 }),
  )
  gate.position.set(0, 0.4, 1.5)
  group.add(body, roof, gate)
  group.position.set(wx, 0, wz)
  group.castShadow = true
  return group
}

// ── Farm ──────────────────────────────────────────────────────────────────────
export function makeFarmMesh(wx: number, wz: number, playerId: number): THREE.Group {
  const group     = new THREE.Group()
  const bodyColor = playerId === 0 ? 0x6b7a2a : 0x7a3a1a
  // Squat building
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.6, 1.6),
    new THREE.MeshLambertMaterial({ color: bodyColor }),
  )
  body.position.y = 0.3
  // Small roof
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 0.6, 4),
    new THREE.MeshLambertMaterial({ color: 0x8B4513 }),
  )
  roof.position.y = 0.9
  roof.rotation.y = Math.PI / 4
  group.add(body, roof)
  group.position.set(wx, 0, wz)
  return group
}

// ── Guard Tower ───────────────────────────────────────────────────────────────
export function makeTowerMesh(wx: number, wz: number, playerId: number): THREE.Group {
  const group     = new THREE.Group()
  const stoneColor = playerId === 0 ? 0x607080 : 0x806070
  // Narrow stone tower
  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 2.8, 0.9),
    new THREE.MeshLambertMaterial({ color: stoneColor }),
  )
  tower.position.y = 1.4
  // Wide platform on top
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.3, 1.5),
    new THREE.MeshLambertMaterial({ color: Math.max(0, stoneColor - 0x0a0a0a) }),
  )
  platform.position.y = 2.95
  // Arrow slit
  const slit = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.5, 0.2),
    new THREE.MeshLambertMaterial({ color: 0x111111 }),
  )
  slit.position.set(0, 1.5, 0.5)
  group.add(tower, platform, slit)
  group.position.set(wx, 0, wz)
  group.castShadow = true
  return group
}

// ── Construction scaffold ─────────────────────────────────────────────────────
export function makeConstructionSite(wx: number, wz: number, w: number, h: number, d: number): THREE.Group {
  const group = new THREE.Group()
  const geo   = new THREE.BoxGeometry(w, h, d)
  const mat   = new THREE.MeshBasicMaterial({ color: 0xaa8844, wireframe: true })
  const mesh  = new THREE.Mesh(geo, mat)
  mesh.position.y = h / 2
  // Semi-transparent fill
  const fillMat = new THREE.MeshLambertMaterial({ color: 0xddbb66, transparent: true, opacity: 0.25 })
  const fill    = new THREE.Mesh(geo, fillMat)
  fill.position.y = h / 2
  group.add(mesh, fill)
  group.position.set(wx, 0, wz)
  return group
}

// ── Projectile ────────────────────────────────────────────────────────────────
const projGeo = new THREE.SphereGeometry(0.12, 5, 5)
const projMat = new THREE.MeshBasicMaterial({ color: 0xffee44 })

export function makeProjectileMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(projGeo, projMat.clone())
  return mesh
}

// ── Path line ─────────────────────────────────────────────────────────────────
export function makePathLine(points: THREE.Vector3[]): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.LineBasicMaterial({ color: COLOR_PATH, linewidth: 2 })
  return new THREE.Line(geo, mat)
}

// ── Carry indicator update ────────────────────────────────────────────────────
export function updateCarryIndicator(mesh: THREE.Mesh, type: 'gold' | 'lumber' | null) {
  if (!type) { mesh.visible = false; return }
  mesh.visible = true
  const mat = mesh.material as THREE.MeshLambertMaterial
  mat.color.setHex(type === 'gold' ? COLOR_CARRY_GOLD : COLOR_CARRY_WOOD)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function blendColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return (r << 16) | (g << 8) | bl
}
