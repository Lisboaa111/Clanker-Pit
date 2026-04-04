import * as THREE from 'three'
import { ResourceNode, ResourceType, Tile, TileType } from '../types'
import { makeTreeMesh, makeGoldMineMesh } from '../../three/meshes'
import { TILE_SIZE, GOLD_MINE_STARTING_AMOUNT, TREE_STARTING_AMOUNT, COLOR_GRASS, COLOR_GRASS_DARK } from '../constants'

let uid = 0
function nextId() { return `res_${uid++}` }

export function createResourceNodes(map: Tile[][], scene: THREE.Scene): ResourceNode[] {
  const nodes: ResourceNode[] = []

  for (let z = 0; z < map.length; z++) {
    for (let x = 0; x < map[z].length; x++) {
      const tile = map[z][x]
      const wx = x * TILE_SIZE + TILE_SIZE / 2
      const wz = z * TILE_SIZE + TILE_SIZE / 2

      if (tile.type === TileType.TREE) {
        const group = makeTreeMesh(wx, wz)
        scene.add(group)
        // Store mesh reference on tile for raycasting
        tile.mesh.userData.resourceId = nextId()
        const node: ResourceNode = {
          id: tile.mesh.userData.resourceId,
          type: ResourceType.LUMBER,
          tileX: x,
          tileZ: z,
          amount: TREE_STARTING_AMOUNT,
          maxAmount: TREE_STARTING_AMOUNT,
          mesh: group as unknown as THREE.Mesh,  // group used as mesh
          depleted: false,
        }
        nodes.push(node)

      } else if (tile.type === TileType.GOLD_MINE) {
        const group = makeGoldMineMesh(wx, wz)
        scene.add(group)
        tile.mesh.userData.resourceId = nextId()
        const node: ResourceNode = {
          id: tile.mesh.userData.resourceId,
          type: ResourceType.GOLD,
          tileX: x,
          tileZ: z,
          amount: GOLD_MINE_STARTING_AMOUNT,
          maxAmount: GOLD_MINE_STARTING_AMOUNT,
          mesh: group as unknown as THREE.Mesh,
          depleted: false,
        }
        nodes.push(node)
      }
    }
  }

  return nodes
}

export function depleteResource(node: ResourceNode, scene: THREE.Scene, map: Tile[][]) {
  node.depleted = true
  scene.remove(node.mesh as unknown as THREE.Object3D)
  const tile = map[node.tileZ][node.tileX]
  tile.type = TileType.GRASS
  tile.mesh.userData.tileType = TileType.GRASS
  // Restore correct checkerboard color (each tile has its own cloned material now)
  const mat = tile.mesh.material as THREE.MeshLambertMaterial
  mat.color.setHex((tile.x + tile.z) % 2 === 0 ? COLOR_GRASS : COLOR_GRASS_DARK)
}
