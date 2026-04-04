import * as THREE from 'three'
import {
  WORKER_SIZE, FOOTMAN_SIZE, ARCHER_SIZE,
  TREE_WIDTH, TREE_HEIGHT, GOLD_MINE_RADIUS, TOWN_HALL_SIZE, TILE_SIZE,
  COLOR_TREE, COLOR_TREE_TRUNK, COLOR_GOLD_MINE, COLOR_GOLD_DARK,
  COLOR_TOWN_HALL, COLOR_SELECTION, COLOR_PATH, COLOR_CARRY_GOLD, COLOR_CARRY_WOOD,
  PLAYER_COLORS, HP_BAR_WIDTH,
  TOWN_HALL_HP_BAR_WIDTH, BARRACKS_HP_BAR_WIDTH, FARM_HP_BAR_WIDTH, TOWER_HP_BAR_WIDTH,
} from '../game/constants'
import { ResourceType } from '../game/types'
import { CharacterAssets, cloneCharacter, createCharacterMixer } from './characterLoader'
import { SurvivalKitAssets, cloneSK } from './survivalKitLoader'

// ── Asset modules (set before game init) ──────────────────────────────────────
let _charAssets: CharacterAssets | null = null
export function setCharacterAssets(assets: CharacterAssets) { _charAssets = assets }

let _skAssets: SurvivalKitAssets | null = null
export function setSurvivalKitAssets(assets: SurvivalKitAssets) { _skAssets = assets }

// ── Skin selection: P0 = survivors, P1 = zombies ──────────────────────────────
function pickTexture(assets: CharacterAssets, playerId: number, isHeavy: boolean) {
  if (playerId === 0) return isHeavy ? assets.textures.survivorMaleB : assets.textures.survivorFemaleA
  return isHeavy ? assets.textures.zombieC : assets.textures.zombieA
}

// ── Shared fallback geometries ────────────────────────────────────────────────
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

// ── Player ownership helpers ──────────────────────────────────────────────────

/** Glowing ground disc beneath a building — player-colored. */
function makeOwnershipDisc(radius: number, playerId: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(radius, 40)
  const mat = new THREE.MeshBasicMaterial({
    color:       PLAYER_COLORS[playerId],
    side:        THREE.DoubleSide,
    transparent: true,
    opacity:     0.30,
    depthWrite:  false,
  })
  const disc = new THREE.Mesh(geo, mat)
  disc.rotation.x = -Math.PI / 2
  disc.position.y = 0.04
  return disc
}

/** Emissive ring border around the disc for extra pop. */
function makeOwnershipRing(radius: number, playerId: number): THREE.Mesh {
  const geo = new THREE.RingGeometry(radius * 0.88, radius, 40)
  const mat = new THREE.MeshBasicMaterial({
    color:       PLAYER_COLORS[playerId],
    side:        THREE.DoubleSide,
    transparent: true,
    opacity:     0.80,
    depthWrite:  false,
  })
  const ring = new THREE.Mesh(geo, mat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.05
  return ring
}

/** Coloured flag pole + pennant. */
function makeOwnershipFlag(playerId: number, poleH: number, offsetX = 0, offsetZ = 0): THREE.Group {
  const group = new THREE.Group()
  // Pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, poleH, 6),
    new THREE.MeshLambertMaterial({ color: 0x999999 }),
  )
  pole.position.y = poleH / 2
  // Pennant (triangle pointing right)
  const flagGeo = new THREE.BufferGeometry()
  const verts = new Float32Array([
    0, poleH,          0,
    0, poleH - 0.38,   0,
    0.62, poleH - 0.19, 0,
  ])
  flagGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  flagGeo.computeVertexNormals()
  const flag = new THREE.Mesh(
    flagGeo,
    new THREE.MeshBasicMaterial({ color: PLAYER_COLORS[playerId], side: THREE.DoubleSide }),
  )
  // Small point light in team colour  const light = new THREE.PointLight(PLAYER_COLORS[playerId], 1.6, 9)
  light.position.y = poleH * 0.7
  group.add(pole, flag, light)
  group.position.set(offsetX, 0, offsetZ)
  return group
}

// ── Character mesh factory (FBX or fallback box) ─────────────────────────────
function makeUnitMesh(
  playerId: number,
  isHeavy: boolean,
  fallbackColor: number,
  fallbackGeo: THREE.BufferGeometry,
  fallbackY: number,
): THREE.Mesh {
  if (_charAssets) {
    const tex       = pickTexture(_charAssets, playerId, isHeavy)
    const character = cloneCharacter(_charAssets, tex)
    const container = new THREE.Group()
    container.add(character)

    // Store mixer + actions in userData for the game loop to drive
    const { mixer, actions } = createCharacterMixer(character, _charAssets.clips)
    container.userData.animMixer   = mixer
    container.userData.animActions = actions
    container.userData.currentAnim = 'idle'

    // ── Team ownership indicator: large glowing ground ring ─────────────
    const ringGeo = new THREE.RingGeometry(0.30, 0.50, 28)
    const ringMat = new THREE.MeshBasicMaterial({
      color:       PLAYER_COLORS[playerId],
      side:        THREE.DoubleSide,
      transparent: true,
      opacity:     0.75,
      depthWrite:  false,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.02
    container.add(ring)

    // ── Floating team-colour dot above the character's head ──────────────
    const dotGeo = new THREE.CircleGeometry(0.14, 14)
    const dotMat = new THREE.MeshBasicMaterial({
      color:      PLAYER_COLORS[playerId],
      side:       THREE.DoubleSide,
      depthWrite: false,
    })
    const dot = new THREE.Mesh(dotGeo, dotMat)
    dot.rotation.x = -Math.PI / 2
    dot.position.y = 2.25
    container.add(dot)

    return container as unknown as THREE.Mesh
  }

  // Fallback: coloured box
  const mat  = new THREE.MeshLambertMaterial({ color: fallbackColor })
  const mesh = new THREE.Mesh(fallbackGeo, mat)
  mesh.castShadow = true
  mesh.position.y = fallbackY
  return mesh
}

// ── Worker / Footman / Archer meshes ─────────────────────────────────────────
export function makeWorkerMesh(playerId: number): THREE.Mesh {
  return makeUnitMesh(playerId, false,
    PLAYER_COLORS[playerId] ?? PLAYER_COLORS[0],
    workerGeo, WORKER_SIZE / 2 + 0.08)
}

export function makeFootmanMesh(playerId: number): THREE.Mesh {
  return makeUnitMesh(playerId, true,
    PLAYER_COLORS[playerId] ?? PLAYER_COLORS[0],
    footmanBodyGeo, FOOTMAN_SIZE * 0.7 + 0.08)
}

export function makeArcherMesh(playerId: number): THREE.Mesh {
  return makeUnitMesh(playerId, false,
    blendColor(PLAYER_COLORS[playerId] ?? PLAYER_COLORS[0], 0xffffff, 0.25),
    archerBodyGeo, ARCHER_SIZE * 0.65 + 0.08)
}

// ── Selection ring ─────────────────────────────────────────────────────────
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

// ── Level indicator ───────────────────────────────────────────────────────────
export function makeLevelIndicator(level: number): THREE.Mesh | null {
  if (level <= 1) return null
  const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12)
  const color = level === 2 ? 0xcccccc : 0xffcc00
  const mat = new THREE.MeshBasicMaterial({ color })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(0.2, WORKER_SIZE + 0.42, 0)
  return mesh
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

// ── HP bar update ─────────────────────────────────────────────────────────────
export function updateHealthBarFill(fill: THREE.Mesh, ratio: number, barWidth = HP_BAR_WIDTH) {
  const r = Math.max(0.001, Math.min(1, ratio))
  fill.scale.x = r
  fill.position.x = -(1 - r) * barWidth / 2
  const mat = fill.material as THREE.MeshBasicMaterial
  if (r > 0.6)       mat.color.setHex(0x00cc44)
  else if (r > 0.3)  mat.color.setHex(0xddaa00)
  else               mat.color.setHex(0xdd2200)
}

// ── Tree ──────────────────────────────────────────────────────────────────────
export function makeTreeMesh(wx: number, wz: number): THREE.Group {
  const group = new THREE.Group()

  if (_skAssets) {
    const useTall = Math.random() > 0.55
    const template = useTall ? _skAssets['tree-tall'] : _skAssets['tree']
    const tree = cloneSK(template)
    // Kenney trees are ~2 units tall at scale 1 — bump to game height
    tree.scale.setScalar(useTall ? 1.4 : 1.2)
    tree.rotation.y = Math.random() * Math.PI * 2
    group.add(tree)
  } else {
    const trunk = new THREE.Mesh(treeTrunkGeo, trunkMat)
    trunk.position.y = TREE_HEIGHT * 0.25
    const top = new THREE.Mesh(treeTopGeo, treeMat)
    top.position.y = TREE_HEIGHT * 0.65
    group.add(trunk, top)
  }

  group.position.set(wx, 0, wz)
  group.castShadow = true
  return group
}

// ── Gold Mine ────────────────────────────────────────────────────────────────
export function makeGoldMineMesh(wx: number, wz: number): THREE.Group {
  const group = new THREE.Group()

  if (_skAssets) {
    const chest = cloneSK(_skAssets['chest'])
    // Chest is small — scale up to be noticeable on the map
    chest.scale.setScalar(0.75)
    chest.rotation.y = Math.random() * Math.PI * 2
    group.add(chest)
    // Golden ground glow
    group.add(makeOwnershipDisc(1.0, 0))  // reuse disc helper with gold colour override
    const glow = group.children[group.children.length - 1] as THREE.Mesh
    ;(glow.material as THREE.MeshBasicMaterial).color.setHex(0xffd700)
    ;(glow.material as THREE.MeshBasicMaterial).opacity = 0.35
  } else {
    const base  = new THREE.Mesh(goldGeo, goldMineMat)
    base.position.y = GOLD_MINE_RADIUS * 0.8
    base.rotation.y = Math.PI / 4
    const inner = new THREE.Mesh(
      new THREE.OctahedronGeometry(GOLD_MINE_RADIUS * 0.5, 0), goldMineAlt,
    )
    inner.position.y = GOLD_MINE_RADIUS * 1.2
    group.add(base, inner)
  }

  group.position.set(wx, 0, wz)
  group.castShadow = true
  return group
}

// ── Town Hall ─────────────────────────────────────────────────────────────────
export function makeTownHallMesh(wx: number, wz: number, playerId: number): THREE.Group {
  const group = new THREE.Group()

  if (_skAssets) {
    const bldg = cloneSK(_skAssets['structure'])
    // Scale to roughly TOWN_HALL_SIZE world units wide
    bldg.scale.setScalar(2.2)
    group.add(bldg)
  } else {
    const bodyColor = playerId === 0 ? COLOR_TOWN_HALL : 0x7a3030
    const roofColor = playerId === 0 ? 0x6b4226 : 0x5a1a1a
    const body = new THREE.Mesh(townHallGeo, new THREE.MeshLambertMaterial({ color: bodyColor }))
    body.position.y = (TOWN_HALL_SIZE * 0.6) / 2
    const roof = new THREE.Mesh(townRoofGeo, new THREE.MeshLambertMaterial({ color: roofColor }))
    roof.position.y = TOWN_HALL_SIZE * 0.6 + TOWN_HALL_SIZE * 0.2
    roof.rotation.y = Math.PI / 4
    group.add(body, roof)
  }

  // ── Ownership indicators ──────────────────────────────────────────────────
  group.add(makeOwnershipDisc(2.5, playerId))
  group.add(makeOwnershipRing(2.5, playerId))
  group.add(makeOwnershipFlag(playerId, 4.5, 1.6, 1.6))

  group.position.set(wx, 0, wz)
  group.castShadow = true
  return group
}

// ── Barracks ──────────────────────────────────────────────────────────────────
export function makeBarracksMesh(wx: number, wz: number, playerId: number): THREE.Group {
  const group = new THREE.Group()

  if (_skAssets) {
    const bldg = cloneSK(_skAssets['structure-metal'])
    bldg.scale.setScalar(2.0)
    group.add(bldg)
  } else {
    const bodyColor = playerId === 0 ? 0x2a3a6a : 0x6a1a1a
    const roofColor = playerId === 0 ? 0x1a2a5a : 0x4a0a0a
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 1.0, 2.8),
      new THREE.MeshLambertMaterial({ color: bodyColor }),
    )
    body.position.y = 0.5
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 0.25, 3.2),
      new THREE.MeshLambertMaterial({ color: roofColor }),
    )
    roof.position.y = 1.1
    const gate = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.8, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x111111 }),
    )
    gate.position.set(0, 0.4, 1.5)
    group.add(body, roof, gate)
  }

  group.add(makeOwnershipDisc(2.2, playerId))
  group.add(makeOwnershipRing(2.2, playerId))
  group.add(makeOwnershipFlag(playerId, 3.5, 1.3, 1.0))

  group.position.set(wx, 0, wz)
  group.castShadow = true
  return group
}

// ── Farm ──────────────────────────────────────────────────────────────────────
export function makeFarmMesh(wx: number, wz: number, playerId: number): THREE.Group {
  const group = new THREE.Group()

  if (_skAssets) {
    const tent = cloneSK(_skAssets['tent'])
    tent.scale.setScalar(1.6)
    group.add(tent)
  } else {
    const bodyColor = playerId === 0 ? 0x6b7a2a : 0x7a3a1a
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.6, 1.6),
      new THREE.MeshLambertMaterial({ color: bodyColor }),
    )
    body.position.y = 0.3
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(1.2, 0.6, 4),
      new THREE.MeshLambertMaterial({ color: 0x8B4513 }),
    )
    roof.position.y = 0.9
    roof.rotation.y = Math.PI / 4
    group.add(body, roof)
  }

  group.add(makeOwnershipDisc(1.6, playerId))
  group.add(makeOwnershipRing(1.6, playerId))
  group.add(makeOwnershipFlag(playerId, 2.8, 1.0, 0.7))

  group.position.set(wx, 0, wz)
  return group
}

// ── Guard Tower ───────────────────────────────────────────────────────────────
export function makeTowerMesh(wx: number, wz: number, playerId: number): THREE.Group {
  const group = new THREE.Group()

  if (_skAssets) {
    const fence = cloneSK(_skAssets['fence-fortified'])
    // Stack two pieces to form a taller tower silhouette
    const base = fence
    base.scale.setScalar(2.2)
    group.add(base)
    // Rock base to look more solid
    const rock = cloneSK(_skAssets['rock-a'])
    rock.scale.setScalar(1.2)
    rock.position.set(-0.3, 0, 0.2)
    group.add(rock)
  } else {
    const stoneColor = playerId === 0 ? 0x607080 : 0x806070
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 2.8, 0.9),
      new THREE.MeshLambertMaterial({ color: stoneColor }),
    )
    tower.position.y = 1.4
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.3, 1.5),
      new THREE.MeshLambertMaterial({ color: Math.max(0, stoneColor - 0x0a0a0a) }),
    )
    platform.position.y = 2.95
    const slit = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.5, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x111111 }),
    )
    slit.position.set(0, 1.5, 0.5)
    group.add(tower, platform, slit)
  }

  group.add(makeOwnershipDisc(1.3, playerId))
  group.add(makeOwnershipRing(1.3, playerId))
  group.add(makeOwnershipFlag(playerId, 3.8, 0.7, 0.5))

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
  return new THREE.Mesh(projGeo, projMat.clone())
}

// ── Loot pile ─────────────────────────────────────────────────────────────────
export function makeLootPileMesh(type: ResourceType): THREE.Mesh {
  if (_skAssets) {
    const template = type === ResourceType.GOLD ? _skAssets['barrel'] : _skAssets['resource-wood']
    const group    = cloneSK(template)
    group.scale.setScalar(type === ResourceType.GOLD ? 0.5 : 0.55)
    group.rotation.y = Math.random() * Math.PI * 2
    group.position.y = 0
    return group as unknown as THREE.Mesh
  }
  const geo   = new THREE.SphereGeometry(0.18, 6, 6)
  const color = type === ResourceType.GOLD ? 0xffd700 : 0x8B4513
  const mesh  = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }))
  mesh.position.y = 0.18
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
  const r  = Math.round(ar + (br - ar) * t)
  const g  = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return (r << 16) | (g << 8) | bl
}
