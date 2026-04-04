import * as THREE from 'three'

export interface RaycastResult {
  point: THREE.Vector3
  object: THREE.Object3D
}

export function createRaycaster() {
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()

  function cast(
    event: MouseEvent,
    camera: THREE.Camera,
    targets: THREE.Object3D[],
  ): RaycastResult | null {
    mouse.x =  (event.clientX / window.innerWidth)  * 2 - 1
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1
    raycaster.setFromCamera(mouse, camera)
    const hits = raycaster.intersectObjects(targets, true)
    if (hits.length === 0) return null
    return { point: hits[0].point, object: hits[0].object }
  }

  function castNDC(
    nx: number, ny: number,
    camera: THREE.Camera,
    targets: THREE.Object3D[],
  ): RaycastResult | null {
    mouse.x = nx
    mouse.y = ny
    raycaster.setFromCamera(mouse, camera)
    const hits = raycaster.intersectObjects(targets, true)
    if (hits.length === 0) return null
    return { point: hits[0].point, object: hits[0].object }
  }

  return { cast, castNDC }
}
