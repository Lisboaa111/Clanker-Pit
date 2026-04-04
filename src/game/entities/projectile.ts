import * as THREE from 'three'
import { Projectile, ProjectileRequest, GameState } from '../types'
import { makeProjectileMesh } from '../../three/meshes'
import { updateHealthBarFill } from '../../three/meshes'
import { damageBuilding } from './building'
import { TILE_SIZE, DEATH_ANIM_DURATION, HP_REGEN_DELAY_TICKS } from '../constants'
import { WorkerState } from '../types'
import { grantXp } from './worker'
import { createLootPile } from './loot'

let uid = 0

export function createProjectile(req: ProjectileRequest, scene: THREE.Scene): Projectile {
  const mesh = makeProjectileMesh()
  mesh.position.set(req.fromX, req.fromY, req.fromZ)
  scene.add(mesh)
  return {
    id: `proj_${uid++}`,
    fromPlayerId: req.fromPlayerId,
    fromWorkerId: req.fromWorkerId,
    x: req.fromX, y: req.fromY, z: req.fromZ,
    targetId: req.targetId,
    targetBuildingId: req.targetBuildingId,
    damage: req.damage,
    speed: req.speed,
    mesh,
    done: false,
  }
}

export function updateProjectiles(
  projectiles: Projectile[],
  dt: number,
  state: GameState,
  scene: THREE.Scene,
) {
  for (const p of projectiles) {
    if (p.done) continue

    // Resolve target position
    let tx: number, ty: number, tz: number

    if (p.targetId) {
      const target = state.workers.find(w => w.id === p.targetId && !w.dead)
      if (!target) { killProjectile(p, scene); continue }
      tx = target.x
      ty = target.mesh.position.y + 0.3
      tz = target.z
    } else if (p.targetBuildingId) {
      const b = state.buildings.find(b => b.id === p.targetBuildingId && !b.destroyed)
      if (!b) { killProjectile(p, scene); continue }
      tx = b.tileX * TILE_SIZE + TILE_SIZE
      ty = 1.8
      tz = b.tileZ * TILE_SIZE + TILE_SIZE
    } else {
      killProjectile(p, scene)
      continue
    }

    const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z
    const d  = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const step = p.speed * dt

    if (d <= step) {
      // ── Arrived: deal damage ─────────────────────────────────────────────
      if (p.targetId) {
        const target = state.workers.find(w => w.id === p.targetId && !w.dead)
        if (target) {
          target.hp = Math.max(0, target.hp - p.damage)
          target.lastDamagedTick = state.tick
          updateHealthBarFill(target.hpFill, target.hp / target.maxHp)

          // Retaliation — any unit not already in combat fights back
          if (
            target.attackTargetId === null &&
            target.attackTargetBuildingId === null &&
            target.state !== WorkerState.MOVING_TO_ATTACK &&
            target.state !== WorkerState.ATTACKING
          ) {
            // Find closest attacker from shooter's team
            let nearest = null, nearestDist = Infinity
            for (const w of state.workers) {
              if (w.dead || w.playerId !== p.fromPlayerId) continue
              const dd = Math.sqrt((w.x - target.x) ** 2 + (w.z - target.z) ** 2)
              if (dd < nearestDist) { nearestDist = dd; nearest = w }
            }
            if (nearest) {
              target.attackTargetId = nearest.id
              target.state = WorkerState.MOVING_TO_ATTACK
            }
          }

          if (target.hp <= 0) {
            target.dead = true
            target.deathAnimTimer = DEATH_ANIM_DURATION
            // Drop loot if target was carrying resources
            if (target.carryAmount > 0 && target.carryType !== null) {
              const pile = createLootPile(target.x, target.z, target.carryType, target.carryAmount, state.tick, scene)
              state.lootPiles.push(pile)
            }
            // Grant XP to the shooting unit
            if (p.fromWorkerId) {
              const shooter = state.workers.find(w => w.id === p.fromWorkerId && !w.dead)
              if (shooter) grantXp(shooter, target, scene)
            }
          }

          // Floating damage number
          window.dispatchEvent(new CustomEvent('dmg-number', {
            detail: { x: tx, y: ty + 0.4, z: tz, amount: p.damage, crit: false }
          }))
        }
      } else if (p.targetBuildingId) {
        const b = state.buildings.find(b => b.id === p.targetBuildingId && !b.destroyed)
        if (b) {
          damageBuilding(b, p.damage)
          window.dispatchEvent(new CustomEvent('dmg-number', {
            detail: { x: tx, y: ty + 0.4, z: tz, amount: p.damage }
          }))
        }
      }
      killProjectile(p, scene)
    } else {
      // ── Move projectile ──────────────────────────────────────────────────
      p.x += (dx / d) * step
      p.y += (dy / d) * step
      p.z += (dz / d) * step
      p.mesh.position.set(p.x, p.y, p.z)
    }
  }
}

function killProjectile(p: Projectile, scene: THREE.Scene) {
  p.done = true
  scene.remove(p.mesh)
}
