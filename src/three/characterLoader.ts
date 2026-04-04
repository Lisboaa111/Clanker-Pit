import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'

const BASE = '/kenney_animated-characters-survivors'

export interface CharacterAssets {
  template: THREE.Group
  clips: {
    idle: THREE.AnimationClip
    run:  THREE.AnimationClip
    jump: THREE.AnimationClip
  }
  textures: {
    survivorFemaleA: THREE.Texture
    survivorMaleB:   THREE.Texture
    zombieA:         THREE.Texture
    zombieC:         THREE.Texture
  }
}

let _cache: CharacterAssets | null = null

export async function loadCharacterAssets(): Promise<CharacterAssets> {
  if (_cache) return _cache

  const fbx = new FBXLoader()
  const tex = new THREE.TextureLoader()

  const [model, idleFbx, runFbx, jumpFbx, tFA, tMB, tZA, tZC] = await Promise.all([
    fbx.loadAsync(`${BASE}/Model/characterMedium.fbx`),
    fbx.loadAsync(`${BASE}/Animations/idle.fbx`),
    fbx.loadAsync(`${BASE}/Animations/run.fbx`),
    fbx.loadAsync(`${BASE}/Animations/jump.fbx`),
    tex.loadAsync(`${BASE}/Skins/survivorFemaleA.png`),
    tex.loadAsync(`${BASE}/Skins/survivorMaleB.png`),
    tex.loadAsync(`${BASE}/Skins/zombieA.png`),
    tex.loadAsync(`${BASE}/Skins/zombieC.png`),
  ])

  // Flip UV for FBX skins
  for (const t of [tFA, tMB, tZA, tZC]) {
    t.colorSpace = THREE.SRGBColorSpace
    t.flipY = false
  }

  // Each animation FBX contains multiple stacks: a template, a "Targeting Pose"
  // (static T-pose reference), and the actual animation. Find the real clip by name.
  const findClip = (fbx: THREE.Group, keyword: string): THREE.AnimationClip => {
    const hit = fbx.animations.find(a => a.name.toLowerCase().includes(keyword.toLowerCase()))
    if (hit) return hit
    // Fallback: pick the longest clip (the actual animation is longest)
    return fbx.animations.reduce((a, b) => (b.duration > a.duration ? b : a), fbx.animations[0])
  }

  _cache = {
    template: model,
    clips: {
      idle: findClip(idleFbx, 'idle'),
      run:  findClip(runFbx,  'run'),
      jump: findClip(jumpFbx, 'jump'),
    },
    textures: { survivorFemaleA: tFA, survivorMaleB: tMB, zombieA: tZA, zombieC: tZC },
  }
  return _cache
}

/** Scale that maps Kenney FBX cm-units to ~1 world-unit tall character. */
export const CHARACTER_SCALE = 0.0055

/**
 * Clone the character template, apply a skin texture, scale it, and return the group.
 * The group origin is at foot level (y=0).
 */
export function cloneCharacter(assets: CharacterAssets, texture: THREE.Texture): THREE.Group {
  const clone = SkeletonUtils.clone(assets.template) as THREE.Group
  const mat   = new THREE.MeshLambertMaterial({ map: texture })
  clone.traverse(child => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh || (child as THREE.Mesh).isMesh) {
      (child as THREE.Mesh).material  = mat
      child.castShadow   = true
      child.receiveShadow = false
    }
  })
  clone.scale.setScalar(CHARACTER_SCALE)
  return clone
}

/**
 * Create an AnimationMixer for a cloned character and return pre-created actions.
 * Call mixer.update(dt) every frame.
 */
export function createCharacterMixer(character: THREE.Group, clips: CharacterAssets['clips']): {
  mixer:   THREE.AnimationMixer
  actions: { idle: THREE.AnimationAction; run: THREE.AnimationAction; jump: THREE.AnimationAction }
} {
  const mixer = new THREE.AnimationMixer(character)
  const actions = {
    idle: mixer.clipAction(clips.idle),
    run:  mixer.clipAction(clips.run),
    jump: mixer.clipAction(clips.jump),
  }
  actions.idle.play()  // start idle by default
  return { mixer, actions }
}

/** Crossfade to a new animation clip name. No-op if already playing. */
export function setCharacterAnim(
  actions: { idle: THREE.AnimationAction; run: THREE.AnimationAction; jump: THREE.AnimationAction },
  name: 'idle' | 'run' | 'jump',
  fadeDuration = 0.15,
) {
  const target = actions[name]
  if (target.isRunning()) return
  for (const a of Object.values(actions)) a.fadeOut(fadeDuration)
  target.reset().fadeIn(fadeDuration).play()
}
