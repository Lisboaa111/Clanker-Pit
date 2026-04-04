import * as THREE from 'three'
import {
  GameState, HUDUpdate, SelectedWorkerInfo, UnitType, CommandType, BuildingType, TileType,
} from './types'
import {
  updateWorker, applyCommand, applyMoveCommandFormation,
  stopWorker, resumeWorker,
  removeDeadWorker, createUnit,
} from './entities/worker'
import {
  updateBuilding, removeDestroyedBuilding,
  createBuilding, completeConstruction, calcSupplyMax,
} from './entities/building'
import { createProjectile, updateProjectiles } from './entities/projectile'
import { updateLootPiles, createLootPile } from './entities/loot'
import { startBuildingUpgrade } from './entities/building'
import { worldToTile } from './pathfinding'
import {
  TILE_SIZE, HUD_UPDATE_INTERVAL,
  TRAIN_WORKER_GOLD, TRAIN_WORKER_LUMBER, TRAIN_WORKER_TIME,
  TRAIN_FOOTMAN_GOLD, TRAIN_FOOTMAN_LUMBER, TRAIN_FOOTMAN_TIME,
  TRAIN_ARCHER_GOLD, TRAIN_ARCHER_LUMBER, TRAIN_ARCHER_TIME,
  BARRACKS_GOLD, BARRACKS_LUMBER,
  FARM_GOLD, FARM_LUMBER,
  TOWER_GOLD, TOWER_LUMBER,
  XP_LEVEL_2, XP_LEVEL_3, XP_LEVEL_HP_BONUS,
} from './constants'
import type { InputSystem } from './input'
import type { CameraController } from '../three/camera'

export interface GameLoop {
  start: () => void
  stop: () => void
}

// Building placement costs
const BUILD_COSTS: Record<BuildingType, { gold: number; lumber: number }> = {
  [BuildingType.TOWN_HALL]: { gold: 0, lumber: 0 },
  [BuildingType.BARRACKS]:  { gold: BARRACKS_GOLD, lumber: BARRACKS_LUMBER },
  [BuildingType.FARM]:      { gold: FARM_GOLD, lumber: FARM_LUMBER },
  [BuildingType.TOWER]:     { gold: TOWER_GOLD, lumber: TOWER_LUMBER },
}

export function createGameLoop(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  cameraCtrl: CameraController,
  state: GameState,
  input: InputSystem,
): GameLoop {
  let animId = 0
  let lastTime = 0
  let lastHUDTime = 0
  let frameCount = 0
  let fps = 0
  let fpsTimer = 0

  // ── Context menu worker actions ───────────────────────────────────────────
  const onWorkerAction = (e: Event) => {
    const { type, workerId } = (e as CustomEvent<{ type: string; workerId: string }>).detail
    const worker = state.workers.find(w => w.id === workerId)
    if (!worker) return
    if (type === 'stop')   stopWorker(worker, scene)
    if (type === 'resume') resumeWorker(worker, state, scene)
  }

  // ── Player switch (debug) ─────────────────────────────────────────────────
  const onSwitchPlayer = () => {
    state.currentPlayerId = state.currentPlayerId === 0 ? 1 : 0
    state.workers.forEach(w => { w.selected = false; w.selectionRing.visible = false })
    state.selectedWorkerIds.clear()
    window.dispatchEvent(new CustomEvent('worker-context-menu', { detail: null }))
    window.dispatchEvent(new CustomEvent('building-selected', { detail: null }))
  }

  // ── Train unit ────────────────────────────────────────────────────────────
  const onTrainUnit = (e: Event) => {
    const { buildingId, unitType } = (e as CustomEvent<{ buildingId: string; unitType: UnitType }>).detail
    const building = state.buildings.find(b => b.id === buildingId && !b.destroyed && !b.underConstruction)
    if (!building || building.playerId !== state.currentPlayerId) return

    // Building-type restrictions
    if (unitType === UnitType.WORKER && building.type !== BuildingType.TOWN_HALL) return
    if ((unitType === UnitType.FOOTMAN || unitType === UnitType.ARCHER) && building.type !== BuildingType.BARRACKS) return

    // Supply check
    const playerId = building.playerId
    if (state.playerSupply[playerId] >= state.playerSupplyMax[playerId]) return

    const pr = state.playerResources[playerId]
    let costGold = 0, costLumber = 0, duration = 0
    switch (unitType) {
      case UnitType.WORKER:  costGold = TRAIN_WORKER_GOLD;  costLumber = TRAIN_WORKER_LUMBER;  duration = TRAIN_WORKER_TIME;  break
      case UnitType.FOOTMAN: costGold = TRAIN_FOOTMAN_GOLD; costLumber = TRAIN_FOOTMAN_LUMBER; duration = TRAIN_FOOTMAN_TIME; break
      case UnitType.ARCHER:  costGold = TRAIN_ARCHER_GOLD;  costLumber = TRAIN_ARCHER_LUMBER;  duration = TRAIN_ARCHER_TIME;  break
    }

    if (pr.gold < costGold || pr.lumber < costLumber) return
    pr.gold   -= costGold
    pr.lumber -= costLumber
    building.trainingQueue.push({ unitType, timer: duration, duration })
  }

  const onUpgradeBuilding = (e: Event) => {
    const detail = (e as CustomEvent<{ buildingId: string }>).detail
    input.commandQueue.push({ type: CommandType.UPGRADE_BUILDING, buildingId: detail.buildingId } as any)
  }

  window.addEventListener('worker-action', onWorkerAction)
  window.addEventListener('switch-player', onSwitchPlayer)
  window.addEventListener('train-unit', onTrainUnit)
  window.addEventListener('upgrade-building', onUpgradeBuilding)

  function tick(now: number) {
    animId = requestAnimationFrame(tick)

    const dt = Math.min((now - lastTime) / 1000, 0.1)
    lastTime = now

    if (state.paused) { renderer.render(scene, cameraCtrl.camera); return }

    frameCount++; fpsTimer += dt
    if (fpsTimer >= 1) { fps = frameCount; frameCount = 0; fpsTimer = 0 }

    cameraCtrl.update(dt, input.keys)

    // ── Process commands ──────────────────────────────────────────────────
    const processCmd = (cmd: import('./types').GameCommand, playerId: number) => {
      if (cmd.type === CommandType.BUILD) {
        const pr = state.playerResources[playerId]
        const cost = BUILD_COSTS[cmd.buildingType]
        if (pr.gold < cost.gold || pr.lumber < cost.lumber) return
        const tile = state.map[cmd.tileZ]?.[cmd.tileX]
        if (!tile || tile.type !== TileType.GRASS) return
        const occupied = state.buildings.some(b => b.tileX === cmd.tileX && b.tileZ === cmd.tileZ && !b.destroyed)
        if (occupied) return
        pr.gold   -= cost.gold
        pr.lumber -= cost.lumber
        const newBuilding = createBuilding(cmd.buildingType, cmd.tileX, cmd.tileZ, playerId, scene, true)
        state.buildings.push(newBuilding)
        state.workers.filter(w => w.playerId === playerId && !w.dead).forEach(w => applyCommand(w, cmd, state, scene))

      } else if (cmd.type === CommandType.MOVE_TO_TILE && cmd.workerIds.length > 1) {
        applyMoveCommandFormation(state.workers, cmd.workerIds, cmd.tileX, cmd.tileZ, false, state, scene)

      } else if (cmd.type === CommandType.ATTACK_MOVE && cmd.workerIds.length > 1) {
        applyMoveCommandFormation(state.workers, cmd.workerIds, cmd.tileX, cmd.tileZ, true, state, scene)

      } else if (cmd.type === CommandType.UPGRADE_BUILDING) {
        const building = state.buildings.find(
          b => b.id === (cmd as any).buildingId && !b.destroyed && !b.upgrading && !b.underConstruction
        )
        if (building && building.playerId === playerId) {
          const pr = state.playerResources[playerId]
          if (pr) startBuildingUpgrade(building, pr)
        }

      } else if (cmd.type === CommandType.TRAIN_UNIT) {
        // Agent-issued train command
        const building = state.buildings.find(b => b.id === (cmd as any).buildingId && !b.destroyed && !b.underConstruction)
        if (!building || building.playerId !== playerId) return
        const unitType = (cmd as any).unitType as UnitType
        if (state.playerSupply[playerId] >= state.playerSupplyMax[playerId]) return
        const pr = state.playerResources[playerId]
        let costGold = 0, costLumber = 0, duration = 0
        switch (unitType) {
          case UnitType.WORKER:  costGold = TRAIN_WORKER_GOLD;  costLumber = TRAIN_WORKER_LUMBER;  duration = TRAIN_WORKER_TIME;  break
          case UnitType.FOOTMAN: costGold = TRAIN_FOOTMAN_GOLD; costLumber = TRAIN_FOOTMAN_LUMBER; duration = TRAIN_FOOTMAN_TIME; break
          case UnitType.ARCHER:  costGold = TRAIN_ARCHER_GOLD;  costLumber = TRAIN_ARCHER_LUMBER;  duration = TRAIN_ARCHER_TIME;  break
        }
        if (pr.gold < costGold || pr.lumber < costLumber) return
        if (unitType === UnitType.WORKER && building.type !== BuildingType.TOWN_HALL) return
        if ((unitType === UnitType.FOOTMAN || unitType === UnitType.ARCHER) && building.type !== BuildingType.BARRACKS) return
        pr.gold -= costGold; pr.lumber -= costLumber
        building.trainingQueue.push({ unitType, timer: duration, duration })

      } else {
        state.workers.filter(w => w.playerId === playerId && !w.dead).forEach(w => applyCommand(w, cmd, state, scene))
      }
    }

    // Human player commands
    while (input.commandQueue.length > 0) {
      processCmd(input.commandQueue.shift()!, state.currentPlayerId)
    }

    // Agent commands (explicit playerId per command)
    while ((state.pendingAgentCommands ?? []).length > 0) {
      const { playerId, command } = state.pendingAgentCommands.shift()!
      processCmd(command, playerId)
    }

    // ── Update workers (collect projectile requests) ───────────────────────
    const projRequests = state.workers.flatMap(w => updateWorker(w, dt, state, scene))

    projRequests.forEach(req => {
      state.projectiles.push(createProjectile(req, scene))
    })

    // ── Update projectiles ────────────────────────────────────────────────
    updateProjectiles(state.projectiles, dt, state, scene)
    state.projectiles = state.projectiles.filter(p => !p.done)

    // ── Remove dead workers (after death animation completes) ─────────────
    const toRemove = state.workers.filter(w => w.dead && w.deathAnimTimer <= 0)
    toRemove.forEach(w => {
      // Drop loot if the worker was carrying resources when they died
      if (w.carryAmount > 0 && w.carryType !== null) {
        const pile = createLootPile(w.x, w.z, w.carryType, w.carryAmount, state.tick, scene)
        state.lootPiles.push(pile)
      }
      removeDeadWorker(w, scene)
      state.selectedWorkerIds.delete(w.id)
    })
    if (toRemove.length > 0) {
      state.workers = state.workers.filter(w => !(w.dead && w.deathAnimTimer <= 0))
    }

    // Update loot piles (animate, despawn, auto-collect)
    updateLootPiles(state.lootPiles, state.workers, state.playerResources, dt, state.tick, scene)
    state.lootPiles = state.lootPiles.filter(l => l.amount > 0)

    // ── Update buildings ──────────────────────────────────────────────────
    state.buildings.forEach(b => {
      const update = updateBuilding(b, dt, state, scene)
      if (!update) return

      if (update.spawn) {
        const { unitType, playerId, tileX, tileZ, bonusXp } = update.spawn
        const unit = createUnit(unitType, tileX, tileZ, playerId, scene)
        if (bonusXp > 0) {
          unit.xp = bonusXp
          if (unit.xp >= XP_LEVEL_3) unit.level = 3
          else if (unit.xp >= XP_LEVEL_2) unit.level = 2
          if (unit.level > 1) {
            unit.maxHp = unit.maxHp * (1 + (unit.level - 1) * XP_LEVEL_HP_BONUS)
            unit.hp = unit.maxHp
          }
        }
        state.workers.push(unit)
      }
      if (update.projectile) {
        state.projectiles.push(createProjectile(update.projectile, scene))
      }
    })

    // ── Remove destroyed buildings + win condition ────────────────────────
    const destroyedBuildings = state.buildings.filter(b => b.destroyed)
    if (destroyedBuildings.length > 0) {
      destroyedBuildings.forEach(b => {
        removeDestroyedBuilding(b, scene)
        // Check if any Town Hall was destroyed → game over
        if (b.type === BuildingType.TOWN_HALL) {
          window.dispatchEvent(new CustomEvent('game-over', { detail: { winnerId: 1 - b.playerId } }))
          state.paused = true
        }
      })
      state.buildings = state.buildings.filter(b => !b.destroyed)
    }

    // ── Supply calculation ────────────────────────────────────────────────
    state.playerSupplyMax[0] = calcSupplyMax(state.buildings, 0)
    state.playerSupplyMax[1] = calcSupplyMax(state.buildings, 1)
    state.playerSupply[0] = state.workers.filter(w => w.playerId === 0 && !w.dead).length
    state.playerSupply[1] = state.workers.filter(w => w.playerId === 1 && !w.dead).length

    state.tick++
    renderer.render(scene, cameraCtrl.camera)

    if (now - lastHUDTime > HUD_UPDATE_INTERVAL) {
      lastHUDTime = now
      emitHUD(state, fps, input, cameraCtrl)
    }
  }

  function start() { lastTime = performance.now(); animId = requestAnimationFrame(tick) }
  function stop() {
    cancelAnimationFrame(animId)
    window.removeEventListener('worker-action', onWorkerAction)
    window.removeEventListener('switch-player', onSwitchPlayer)
    window.removeEventListener('train-unit', onTrainUnit)
    window.removeEventListener('upgrade-building', onUpgradeBuilding)
  }

  return { start, stop }
}

function toInfo(w: WorkerLike): SelectedWorkerInfo {
  const { x, z } = worldToTile(w.x, w.z, TILE_SIZE)
  return {
    id: w.id,
    playerId: w.playerId,
    unitType: w.unitType,
    state: w.state,
    carryType: w.carryType,
    carryAmount: w.carryAmount,
    maxCarry: w.maxCarry,
    tileX: x, tileZ: z,
    pathLength: Math.max(0, w.path.length - w.pathIndex),
    hp: w.hp, maxHp: w.maxHp,
    xp: w.xp,
    level: w.level,
    maxXp: w.level === 1 ? XP_LEVEL_2 : w.level === 2 ? XP_LEVEL_3 : 0,
  }
}

function emitHUD(state: GameState, fps: number, input: InputSystem, cameraCtrl: CameraController) {
  const pr = state.playerResources[state.currentPlayerId]
  const liveWorkers = state.workers.filter(w => !w.dead)
  const allWorkers      = liveWorkers.map(toInfo)
  const selectedWorkers = liveWorkers.filter(w => w.selected).map(toInfo)
  const camPos = cameraCtrl.getWorldPosition()

  const update: HUDUpdate = {
    gold:               pr.gold,
    lumber:             pr.lumber,
    fps,
    workerCount:        liveWorkers.filter(w => w.playerId === state.currentPlayerId).length,
    goldMinesRemaining: state.resources.filter(r => !r.depleted && r.type === 'gold').length,
    treesRemaining:     state.resources.filter(r => !r.depleted && r.type === 'lumber').length,
    selectedWorkers,
    allWorkers,
    buildings: state.buildings.map(b => ({
      id: b.id,
      playerId: b.playerId,
      type: b.type,
      hp: b.hp,
      maxHp: b.maxHp,
      trainingQueue: b.trainingQueue.map(item => ({ ...item })),
      underConstruction: b.underConstruction,
      buildProgress: b.buildProgress,
      level: b.level,
      upgrading: b.upgrading,
      upgradeProgress: b.upgradeProgress,
    })),
    playerSupply:    state.playerSupply[state.currentPlayerId],
    playerSupplyMax: state.playerSupplyMax[state.currentPlayerId],
    cameraX:         Math.round(camPos.x * 10) / 10,
    cameraZ:         Math.round(camPos.z * 10) / 10,
    lastRaycastTile: input.lastRaycastTile,
    currentPlayerId: state.currentPlayerId,
  }

  window.dispatchEvent(new CustomEvent('hud-update', { detail: update }))
}

// Type alias to avoid circular import
type WorkerLike = Parameters<typeof import('./entities/worker').updateWorker>[0]
