import * as THREE from 'three'
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, CAMERA_PAN_SPEED, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX, CAMERA_ZOOM_SPEED } from '../game/constants'

const MAP_W = MAP_WIDTH  * TILE_SIZE
const MAP_H = MAP_HEIGHT * TILE_SIZE

export interface CameraController {
  camera: THREE.PerspectiveCamera
  update: (dt: number, keys: Set<string>) => void
  onWheel: (e: WheelEvent) => void
  getWorldPosition: () => { x: number; z: number }
}

export function createCamera(aspect: number): CameraController {
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 500)

  // Initial position — look at spawn area
  let targetX = 16
  let targetZ = 16
  let zoom    = 30  // height above target

  function applyPosition() {
    camera.position.set(targetX - zoom * 0.35, zoom, targetZ + zoom * 0.6)
    camera.lookAt(targetX, 0, targetZ)
  }

  applyPosition()

  function update(dt: number, keys: Set<string>) {
    const speed = CAMERA_PAN_SPEED * dt
    let moved = false

    if (keys.has('KeyW') || keys.has('ArrowUp'))    { targetZ -= speed; moved = true }
    if (keys.has('KeyS') || keys.has('ArrowDown'))  { targetZ += speed; moved = true }
    if (keys.has('KeyA') || keys.has('ArrowLeft'))  { targetX -= speed; moved = true }
    if (keys.has('KeyD') || keys.has('ArrowRight')) { targetX += speed; moved = true }

    // Clamp to map bounds
    targetX = Math.max(2, Math.min(MAP_W - 2, targetX))
    targetZ = Math.max(2, Math.min(MAP_H - 2, targetZ))

    if (moved) applyPosition()
  }

  function onWheel(e: WheelEvent) {
    zoom += e.deltaY * 0.05 * CAMERA_ZOOM_SPEED
    zoom = Math.max(CAMERA_ZOOM_MIN, Math.min(CAMERA_ZOOM_MAX, zoom))
    applyPosition()
  }

  function getWorldPosition() {
    return { x: targetX, z: targetZ }
  }

  return { camera, update, onWheel, getWorldPosition }
}
