import * as THREE from 'three'
import { GameState, GameCommand, CommandType, TileType, BuildingType } from './types'
import { setWorkerSelected } from './entities/worker'
import { worldToTile } from './pathfinding'
import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, WORKER_SIZE } from './constants'
import { createRaycaster } from '../three/raycaster'

export interface WorkerContextMenuEvent {
  workerId: string
  screenX: number
  screenY: number
  workerState: string
  hasJob: boolean
}

export interface BuildingSelectedEvent {
  buildingId: string
  screenX: number
  screenY: number
}

export interface BoxSelectEvent {
  active: boolean
  x1: number; y1: number; x2: number; y2: number
}

export interface InputSystem {
  keys: Set<string>
  commandQueue: GameCommand[]
  lastRaycastTile: { x: number; z: number } | null
  pendingBuildType: BuildingType | null
  destroy: () => void
}

export function createInputSystem(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  scene: THREE.Scene,
  getState: () => GameState,
  getPickTargets: () => THREE.Object3D[],
): InputSystem {
  const keys = new Set<string>()
  const commandQueue: GameCommand[] = []
  let lastRaycastTile: { x: number; z: number } | null = null
  let pendingBuildType: BuildingType | null = null

  const { cast } = createRaycaster()

  // ── Build-mode listener ───────────────────────────────────────────────────
  const onEnterBuildMode = (e: Event) => {
    const { buildingType } = (e as CustomEvent<{ buildingType: BuildingType }>).detail
    pendingBuildType = buildingType
    window.dispatchEvent(new CustomEvent('build-mode-changed', { detail: { buildingType } }))
  }
  window.addEventListener('enter-build-mode', onEnterBuildMode)

  const cancelBuildMode = () => {
    if (pendingBuildType !== null) {
      pendingBuildType = null
      window.dispatchEvent(new CustomEvent('build-mode-changed', { detail: { buildingType: null } }))
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
    keys.add(e.code)
    if (e.code === 'Escape') cancelBuildMode()
  }
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code)

  // ── Drag-select state ─────────────────────────────────────────────────────
  let mouseDownPos = { x: 0, y: 0 }
  let isLeftDown   = false
  let isDragSelecting = false
  const DRAG_THRESHOLD = 6

  const onMouseDown = (e: MouseEvent) => {
    mouseDownPos = { x: e.clientX, y: e.clientY }
    if (e.button === 0) {
      isLeftDown = true
      isDragSelecting = false
    }
  }

  const onMouseMove = (e: MouseEvent) => {
    // Update tile under cursor
    const hit = cast(e, camera, getPickTargets())
    if (hit) {
      const t = worldToTile(hit.point.x, hit.point.z, TILE_SIZE)
      if (t.x >= 0 && t.x < MAP_WIDTH && t.z >= 0 && t.z < MAP_HEIGHT) lastRaycastTile = t
    }

    // Drag-select box
    if (isLeftDown) {
      const dx = e.clientX - mouseDownPos.x
      const dy = e.clientY - mouseDownPos.y
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        isDragSelecting = true
        window.dispatchEvent(new CustomEvent('box-select', {
          detail: {
            active: true,
            x1: Math.min(mouseDownPos.x, e.clientX),
            y1: Math.min(mouseDownPos.y, e.clientY),
            x2: Math.max(mouseDownPos.x, e.clientX),
            y2: Math.max(mouseDownPos.y, e.clientY),
          } satisfies BoxSelectEvent,
        }))
      }
    }
  }

  const onMouseUp = (e: MouseEvent) => {
    const state = getState()

    if (e.button === 0) {
      isLeftDown = false
      window.dispatchEvent(new CustomEvent('worker-context-menu', { detail: null }))

      if (isDragSelecting) {
        // Finalise box selection
        const x1 = Math.min(mouseDownPos.x, e.clientX)
        const y1 = Math.min(mouseDownPos.y, e.clientY)
        const x2 = Math.max(mouseDownPos.x, e.clientX)
        const y2 = Math.max(mouseDownPos.y, e.clientY)
        boxSelectWorkers(x1, y1, x2, y2, state)
        window.dispatchEvent(new CustomEvent('box-select', {
          detail: { active: false, x1, y1, x2, y2 } satisfies BoxSelectEvent,
        }))
        isDragSelecting = false
        window.dispatchEvent(new CustomEvent('building-selected', { detail: null }))
        return
      }

      const hit = cast(e, camera, getPickTargets())
      handleLeftClick(e, hit, state, camera)
    } else if (e.button === 2) {
      const hit = cast(e, camera, getPickTargets())
      handleRightClick(e, hit, state)
    }
  }

  const onContextMenu = (e: Event) => e.preventDefault()

  // ── Box selection ─────────────────────────────────────────────────────────
  function boxSelectWorkers(
    x1: number, y1: number, x2: number, y2: number,
    state: GameState,
  ) {
    // Deselect all first
    state.workers.forEach(w => setWorkerSelected(w, false, scene))
    state.selectedWorkerIds.clear()

    state.workers.forEach(w => {
      if (w.dead || w.playerId !== state.currentPlayerId) return

      // Project 3D position into screen space
      const pos = new THREE.Vector3(w.x, w.mesh.position.y + 0.3, w.z)
      pos.project(camera)
      const sx = ((pos.x + 1) / 2) * window.innerWidth
      const sy = ((-pos.y + 1) / 2) * window.innerHeight

      if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
        setWorkerSelected(w, true, scene)
        state.selectedWorkerIds.add(w.id)
      }
    })
  }

  // ── Click helpers ─────────────────────────────────────────────────────────
  function findClickedWorker(hit: ReturnType<typeof cast>, state: GameState) {
    return hit ? state.workers.find(w => !w.dead && isDescendant(hit.object, w.mesh)) : undefined
  }

  function findClickedBuilding(hit: ReturnType<typeof cast>, state: GameState) {
    if (!hit) return undefined
    let cur: THREE.Object3D | null = hit.object
    while (cur) {
      if (cur.userData?.buildingId) {
        return state.buildings.find(b => b.id === cur!.userData.buildingId && !b.destroyed)
      }
      cur = cur.parent
    }
    return undefined
  }

  function handleLeftClick(
    e: MouseEvent,
    hit: ReturnType<typeof cast>,
    state: GameState,
    cam: THREE.PerspectiveCamera,
  ) {
    // Left-click cancels build mode
    if (pendingBuildType !== null) {
      cancelBuildMode()
      return
    }

    const clicked = findClickedWorker(hit, state)
    const isMulti = e.shiftKey

    if (clicked) {
      if (clicked.playerId !== state.currentPlayerId) return

      if (!isMulti) {
        state.workers.forEach(w => setWorkerSelected(w, w.id === clicked.id, scene))
        state.selectedWorkerIds = new Set([clicked.id])
      } else {
        const sel = !clicked.selected
        setWorkerSelected(clicked, sel, scene)
        sel ? state.selectedWorkerIds.add(clicked.id) : state.selectedWorkerIds.delete(clicked.id)
      }
      window.dispatchEvent(new CustomEvent('building-selected', { detail: null }))
      return
    }

    const clickedBuilding = findClickedBuilding(hit, state)
    if (clickedBuilding) {
      if (clickedBuilding.playerId === state.currentPlayerId) {
        const bwx = clickedBuilding.tileX * TILE_SIZE + TILE_SIZE
        const bwz = clickedBuilding.tileZ * TILE_SIZE + TILE_SIZE
        const worldPos = new THREE.Vector3(bwx, 2, bwz)
        worldPos.project(cam)
        const screenX = ((worldPos.x + 1) / 2) * window.innerWidth
        const screenY = ((-worldPos.y + 1) / 2) * window.innerHeight
        window.dispatchEvent(new CustomEvent('building-selected', {
          detail: { buildingId: clickedBuilding.id, screenX, screenY } satisfies BuildingSelectedEvent,
        }))
      } else {
        window.dispatchEvent(new CustomEvent('building-selected', { detail: null }))
      }
      return
    }

    if (!isMulti) {
      state.workers.forEach(w => setWorkerSelected(w, false, scene))
      state.selectedWorkerIds.clear()
    }
    window.dispatchEvent(new CustomEvent('building-selected', { detail: null }))
  }

  function handleRightClick(e: MouseEvent, hit: ReturnType<typeof cast>, state: GameState) {
    if (!hit) return
    const workerIds = Array.from(state.selectedWorkerIds)

    // ── Build-mode placement ───────────────────────────────────────────────
    if (pendingBuildType !== null) {
      if (workerIds.length === 0) { cancelBuildMode(); return }
      const tileObj = findTileMesh(hit.object)
      if (tileObj) {
        const { tileX, tileZ, tileType } = tileObj.userData
        if (tileType === TileType.GRASS) {
          commandQueue.push({ type: CommandType.BUILD, workerIds, buildingType: pendingBuildType, tileX, tileZ })
        }
      } else {
        const t = worldToTile(hit.point.x, hit.point.z, TILE_SIZE)
        commandQueue.push({ type: CommandType.BUILD, workerIds, buildingType: pendingBuildType, tileX: t.x, tileZ: t.z })
      }
      cancelBuildMode()
      return
    }

    const clicked = findClickedWorker(hit, state)

    if (clicked && clicked.playerId === state.currentPlayerId) {
      const worldPos = new THREE.Vector3(clicked.x, WORKER_SIZE, clicked.z)
      worldPos.project(camera)
      const screenX = ((worldPos.x + 1) / 2) * window.innerWidth
      const screenY = ((-worldPos.y + 1) / 2) * window.innerHeight
      window.dispatchEvent(new CustomEvent('worker-context-menu', {
        detail: {
          workerId: clicked.id, screenX, screenY,
          workerState: clicked.state,
          hasJob: clicked.targetResourceId !== null || clicked.lastResourceId !== null,
        } satisfies WorkerContextMenuEvent,
      }))
      return
    }

    if (clicked && clicked.playerId !== state.currentPlayerId && workerIds.length > 0) {
      commandQueue.push({ type: CommandType.ATTACK_UNIT, workerIds, targetWorkerId: clicked.id })
      return
    }

    const clickedBuilding = findClickedBuilding(hit, state)
    if (clickedBuilding) {
      if (clickedBuilding.playerId !== state.currentPlayerId && workerIds.length > 0) {
        commandQueue.push({ type: CommandType.ATTACK_BUILDING, workerIds, targetBuildingId: clickedBuilding.id })
      }
      return
    }

    if (workerIds.length === 0) return

    const tileObj = findTileMesh(hit.object)
    if (tileObj) {
      const { tileX, tileZ, tileType, resourceId } = tileObj.userData

      if ((tileType === TileType.TREE || tileType === TileType.GOLD_MINE) && resourceId) {
        const res = state.resources.find(r => r.id === resourceId && !r.depleted)
        if (res) {
          commandQueue.push({ type: CommandType.GATHER_RESOURCE, workerIds, resourceId: res.id })
          return
        }
      }

      if (keys.has('KeyA')) {
        commandQueue.push({ type: CommandType.ATTACK_MOVE, workerIds, tileX, tileZ })
      } else {
        commandQueue.push({ type: CommandType.MOVE_TO_TILE, workerIds, tileX, tileZ })
      }
      return
    }

    const t = worldToTile(hit.point.x, hit.point.z, TILE_SIZE)
    if (keys.has('KeyA')) {
      commandQueue.push({ type: CommandType.ATTACK_MOVE, workerIds, tileX: t.x, tileZ: t.z })
    } else {
      commandQueue.push({ type: CommandType.MOVE_TO_TILE, workerIds, tileX: t.x, tileZ: t.z })
    }
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mouseup', onMouseUp)
  canvas.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  function destroy() {
    canvas.removeEventListener('mousedown', onMouseDown)
    canvas.removeEventListener('mousemove', onMouseMove)
    canvas.removeEventListener('mouseup', onMouseUp)
    canvas.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('enter-build-mode', onEnterBuildMode)
  }

  return {
    keys,
    commandQueue,
    get lastRaycastTile() { return lastRaycastTile },
    get pendingBuildType() { return pendingBuildType },
    destroy,
  }
}

function isDescendant(obj: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj
  while (cur) { if (cur === ancestor) return true; cur = cur.parent }
  return false
}

function findTileMesh(obj: THREE.Object3D): THREE.Object3D | null {
  let cur: THREE.Object3D | null = obj
  while (cur) { if (cur.userData?.tileX !== undefined) return cur; cur = cur.parent }
  return null
}
