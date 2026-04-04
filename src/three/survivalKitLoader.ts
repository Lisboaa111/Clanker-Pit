import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// GLB format folder (space must be %20 encoded for fetch)
const BASE = '/kenney_survival-kit/Models/GLB%20format'

export type SKKey =
  | 'tree' | 'tree-tall' | 'rock-a' | 'rock-b' | 'rock-c'
  | 'chest' | 'barrel' | 'resource-wood' | 'campfire-stand'
  | 'structure' | 'structure-metal' | 'tent' | 'fence-fortified'
  | 'grass-large'

export type SurvivalKitAssets = Record<SKKey, THREE.Group>

let _cache: SurvivalKitAssets | null = null

export async function loadSurvivalKitAssets(): Promise<SurvivalKitAssets> {
  if (_cache) return _cache

  const loader = new GLTFLoader()

  const keys: SKKey[] = [
    'tree', 'tree-tall', 'rock-a', 'rock-b', 'rock-c',
    'chest', 'barrel', 'resource-wood', 'campfire-stand',
    'structure', 'structure-metal', 'tent', 'fence-fortified',
    'grass-large',
  ]

  const scenes = await Promise.all(
    keys.map(k =>
      loader.loadAsync(`${BASE}/${k}.glb`).then(gltf => {
        gltf.scene.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow    = true
            child.receiveShadow = true
          }
        })
        return gltf.scene
      }),
    ),
  )

  _cache = Object.fromEntries(keys.map((k, i) => [k, scenes[i]])) as SurvivalKitAssets
  return _cache
}

/** Shallow-deep clone of a static GLB scene (no skinning → regular clone is safe). */
export function cloneSK(template: THREE.Group): THREE.Group {
  return template.clone(true)
}
