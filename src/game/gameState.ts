import * as THREE from 'three'
import { GameState } from './types'
import { generateMap } from './map'
import { createResourceNodes } from './entities/resource'
import { createTownHall } from './entities/building'
import { createWorker, createFootman, createArcher } from './entities/worker'

// Player 0 spawns top-left, Player 1 spawns bottom-right
const P0_HALL_X = 6,  P0_HALL_Z = 6
const P1_HALL_X = 38, P1_HALL_Z = 38
const WORKER_COUNT = 4

export function initGameState(scene: THREE.Scene): GameState {
  const map       = generateMap(scene)
  const resources = createResourceNodes(map, scene)

  const th0 = createTownHall(P0_HALL_X, P0_HALL_Z, 0, scene)
  const th1 = createTownHall(P1_HALL_X, P1_HALL_Z, 1, scene)

  // Workers
  const workers0 = Array.from({ length: WORKER_COUNT }, (_, i) =>
    createWorker(P0_HALL_X + 2 + i, P0_HALL_Z + 1, 0, scene)
  )
  const workers1 = Array.from({ length: WORKER_COUNT }, (_, i) =>
    createWorker(P1_HALL_X - 2 - i, P1_HALL_Z - 1, 1, scene)
  )

  // Starting combat units: 2 footmen + 1 archer per player
  const footmen0 = [
    createFootman(P0_HALL_X + 2, P0_HALL_Z + 3, 0, scene),
    createFootman(P0_HALL_X + 3, P0_HALL_Z + 3, 0, scene),
  ]
  const footmen1 = [
    createFootman(P1_HALL_X - 2, P1_HALL_Z - 3, 1, scene),
    createFootman(P1_HALL_X - 3, P1_HALL_Z - 3, 1, scene),
  ]
  const archers0 = [createArcher(P0_HALL_X + 4, P0_HALL_Z + 3, 0, scene)]
  const archers1 = [createArcher(P1_HALL_X - 4, P1_HALL_Z - 3, 1, scene)]

  const allWorkers = [
    ...workers0, ...workers1,
    ...footmen0, ...footmen1,
    ...archers0, ...archers1,
  ]

  return {
    map,
    workers: allWorkers,
    buildings: [th0, th1],
    resources,
    projectiles: [],
    lootPiles: [],
    playerResources: [
      { gold: 300, lumber: 150 },
      { gold: 300, lumber: 150 },
    ],
    playerSupply: [7, 7],      // 4 workers + 2 footmen + 1 archer
    playerSupplyMax: [5, 5],   // will be recalculated on first frame (from town halls)
    selectedWorkerIds: new Set(),
    currentPlayerId: 0,
    tick: 0,
    paused: false,
  }
}
