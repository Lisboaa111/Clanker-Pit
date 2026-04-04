import * as THREE from 'three'
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../game/constants'

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x87ceeb)  // fallback until sky texture loads
  scene.fog = new THREE.Fog(0xc8d8e8, 60, 160)

  // Load equirectangular sky panorama as background + environment
  const loader = new THREE.TextureLoader()
  loader.load('/sky_11_2k.png', (tex) => {
    tex.mapping    = THREE.EquirectangularReflectionMapping
    tex.colorSpace = THREE.SRGBColorSpace
    scene.background  = tex
    scene.environment = tex   // HDRI ambient bounce lighting
  })

  // Ambient light
  const ambient = new THREE.AmbientLight(0xffffff, 0.65)
  scene.add(ambient)

  // Sun (directional)
  const sun = new THREE.DirectionalLight(0xfff5e0, 1.1)
  sun.position.set(30, 60, 20)
  sun.castShadow = true
  sun.shadow.mapSize.width  = 2048
  sun.shadow.mapSize.height = 2048
  const halfW = (MAP_WIDTH  * TILE_SIZE) / 2
  const halfH = (MAP_HEIGHT * TILE_SIZE) / 2
  sun.shadow.camera.left   = -halfW
  sun.shadow.camera.right  =  halfW
  sun.shadow.camera.top    =  halfH
  sun.shadow.camera.bottom = -halfH
  sun.shadow.camera.near   = 0.5
  sun.shadow.camera.far    = 200
  sun.shadow.bias          = -0.001
  scene.add(sun)

  // Soft fill from opposite side
  const fill = new THREE.DirectionalLight(0xc8e8ff, 0.3)
  fill.position.set(-20, 30, -15)
  scene.add(fill)

  return scene
}
