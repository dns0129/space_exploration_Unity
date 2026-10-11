import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { WorldConfig } from "../shared/flight-state.mjs";
import { sampleSurface } from "../shared/spatial-frame.mjs";
import type { BodyId } from "./solar-system";

// The compatibility distribution embeds its WASM, including in the offline HTML.
let initialization: Promise<void> | undefined;
let initialized = false;
export function initializeWalkingPhysics(): Promise<void> {
  return initialization ??= RAPIER.init().then(() => { initialized = true; });
}

export const CHARACTER_RADIUS_M = 0.22;
export const CHARACTER_HALF_SEGMENT_M = 0.65;
export const CHARACTER_CONTACT_GAP_M = 0.01;
export const CHARACTER_CENTER_HEIGHT_M = CHARACTER_RADIUS_M + CHARACTER_HALF_SEGMENT_M + CHARACTER_CONTACT_GAP_M;
export const WALKING_PATCH_HALF_EXTENT_M = 48;
export const WALKING_PATCH_SPACING_M = 0.5;
const PATCH_REFRESH_DISTANCE_M = 16;
const GROUND_RAY_EDGE_BIAS_M = 0.00001;
export const CAMERA_COLLISION_RADIUS_M = 0.2;
const CAMERA_TERRAIN_GAP_M = 0.02;
const CAMERA_SWEEP_RETREAT_M = 0.001;

/** Vertices are in the same metre frame as the character and are used verbatim by rendering. */
export interface WalkingTerrainPatch {
  vertices: Float32Array;
  indices: Uint32Array;
  revision: number;
  centerLocalM: THREE.Vector3;
  centerRadialM: THREE.Vector3;
  right: THREE.Vector3;
  forward: THREE.Vector3;
  halfExtentM: number;
  radiusM: number;
}

/** Only the nearby metre-scale collision scene lives in Rapier, never astronomical positions. */
export class WalkingPhysics {
  readonly world: RAPIER.World;
  readonly character: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  terrainPatch!: WalkingTerrainPatch;
  private terrainCollider?: RAPIER.Collider;
  private patchRevision = 0;
  collisionCount = 0;
  readonly config: WorldConfig;
  readonly bodyId: BodyId;

  constructor(config: WorldConfig, bodyId: BodyId) {
    this.config = config;
    this.bodyId = bodyId;
    if (!initialized) throw new Error("Call initializeWalkingPhysics before creating the walking physics scene");
    // Character gravity is integrated radially by WalkingDynamics. A global -Y would double it.
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.character = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(CHARACTER_HALF_SEGMENT_M, CHARACTER_RADIUS_M), this.character);
    this.controller = this.world.createCharacterController(CHARACTER_CONTACT_GAP_M);
    this.controller.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.controller.setMinSlopeSlideAngle(50 * Math.PI / 180);
    this.controller.disableAutostep();
    this.controller.disableSnapToGround();
  }


  ensureTerrain(radialM: THREE.Vector3, originRadialM: THREE.Vector3, force = false) {
    if (!force && this.terrainPatch
      && radialM.clone().sub(this.terrainPatch.centerRadialM).projectOnPlane(radialM.clone().normalize()).length() < PATCH_REFRESH_DISTANCE_M) return false;
    const body = this.config.bodies.find(candidate => candidate.id === this.bodyId)!;
    const center = new THREE.Vector3().fromArray(sampleSurface(this.config, body, radialM.toArray()).surfaceRadialM);
    const up = center.clone().normalize();
    const right = new THREE.Vector3(Math.abs(up.y) < 0.9 ? 0 : 1, Math.abs(up.y) < 0.9 ? 1 : 0, 0).cross(up).normalize();
    const forward = up.clone().cross(right).normalize();
    const cells = Math.round(WALKING_PATCH_HALF_EXTENT_M * 2 / WALKING_PATCH_SPACING_M);
    const vertices = new Float32Array((cells + 1) ** 2 * 3);
    const indices = new Uint32Array(cells ** 2 * 6);
    const point = new THREE.Vector3();
    for (let z = 0; z <= cells; z++) for (let x = 0; x <= cells; x++) {
      point.copy(center).addScaledVector(right, x * WALKING_PATCH_SPACING_M - WALKING_PATCH_HALF_EXTENT_M)
        .addScaledVector(forward, z * WALKING_PATCH_SPACING_M - WALKING_PATCH_HALF_EXTENT_M);
      point.fromArray(sampleSurface(this.config, body, point.toArray()).surfaceRadialM).sub(originRadialM);
      point.toArray(vertices, (z * (cells + 1) + x) * 3);
    }
    let i = 0;
    for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) {
      const a = z * (cells + 1) + x, b = a + 1, c = a + cells + 1, d = c + 1;
      // right × forward = up; the same outward winding is used for drawing and collision.
      indices.set([a, b, c, b, d, c], i); i += 6;
    }
    if (this.terrainCollider) this.world.removeCollider(this.terrainCollider, false);
    // Rapier also keeps a JS shape cache. Give it an independent, identical
    // vertex buffer: rebasing translates the collider, while the render buffer
    // is translated below, so mutating one must not double-shift that cache.
    this.terrainCollider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(
      new Float32Array(vertices), indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
    this.terrainPatch = { vertices, indices, revision: ++this.patchRevision,
      centerLocalM: center.clone().sub(originRadialM), centerRadialM: center, right, forward,
      halfExtentM: WALKING_PATCH_HALF_EXTENT_M, radiusM: WALKING_PATCH_HALF_EXTENT_M };
    this.refreshQueries();
    return true;
  }

  setFeet(feetM: THREE.Vector3, up: THREE.Vector3, orientation: THREE.Quaternion) {
    const center = feetM.clone().addScaledVector(up, CHARACTER_CENTER_HEIGHT_M);
    this.character.setTranslation(center, false);
    this.character.setNextKinematicTranslation(center);
    this.character.setRotation(orientation, false);
    this.character.setNextKinematicRotation(orientation);
    this.controller.setUp(up);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  move(feetM: THREE.Vector3, up: THREE.Vector3, orientation: THREE.Quaternion, desiredM: THREE.Vector3, dt: number) {
    this.setFeet(feetM, up, orientation);
    this.world.timestep = dt;
    this.controller.computeColliderMovement(this.collider, desiredM);
    const movement = new THREE.Vector3().copy(this.controller.computedMovement());
    this.collisionCount = this.controller.numComputedCollisions();
    const contactNormals: THREE.Vector3[] = [];
    // Dense, curved triangle meshes can report computedGrounded=false at an
    // internal edge despite a valid upward support contact. Use the controller's
    // actual swept contact normals as well, never an analytical height clamp.
    // Rapier's grounded flag can include contact with an unwalkable slope;
    // gameplay support requires an actual normal within the 50° limit.
    let supported = false;
    if (desiredM.dot(up) <= 0) for (let i = 0; i < this.collisionCount; i++) {
      const contact = this.controller.computedCollision(i);
      if (contact) {
        const n = new THREE.Vector3().copy(contact.normal1);
        contactNormals.push(n);
        if (n.dot(up) >= Math.cos(50 * Math.PI / 180)) supported = true;
      }
    }
    const center = this.character.translation();
    this.character.setNextKinematicTranslation(new THREE.Vector3().copy(center).add(movement));
    this.world.step();
    if (!supported && desiredM.dot(up) <= 0) {
      // A support-only sweep spans Rapier's 0.1 mm numerical buffer. It does
      // not move the character and prevents tiny last substeps toggling contact.
      this.controller.computeColliderMovement(this.collider, up.clone().multiplyScalar(-0.003));
      for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
        const contact = this.controller.computedCollision(i);
        if (contact && new THREE.Vector3().copy(contact.normal1).dot(up) >= Math.cos(50 * Math.PI / 180)) supported = true;
      }
    }
    return { movement, grounded: supported, contactNormals };
  }

  /** Translation only: no velocities, rotations, collider shapes or handles are changed. */
  shiftOrigin(shiftM: THREE.Vector3) {
    const velocities: { body: RAPIER.RigidBody; linear: RAPIER.Vector; angular: RAPIER.Vector }[] = [];
    this.world.forEachRigidBody(body => {
      velocities.push({ body, linear: { ...body.linvel() }, angular: { ...body.angvel() } });
      const next = new THREE.Vector3().copy(body.nextTranslation()).sub(shiftM);
      body.setTranslation(new THREE.Vector3().copy(body.translation()).sub(shiftM), false);
      if (body.isKinematic()) body.setNextKinematicTranslation(next);
    });
    this.world.forEachCollider(collider => {
      if (!collider.parent()) collider.setTranslation(new THREE.Vector3().copy(collider.translation()).sub(shiftM));
    });
    if (this.terrainPatch) {
      const vertices = this.terrainPatch.vertices;
      for (let i = 0; i < vertices.length; i += 3) {
        vertices[i] -= shiftM.x; vertices[i + 1] -= shiftM.y; vertices[i + 2] -= shiftM.z;
      }
      this.terrainPatch.centerLocalM.sub(shiftM);
      this.terrainPatch.revision = ++this.patchRevision;
    }
    this.refreshQueries();
    for (const state of velocities) {
      state.body.setLinvel(state.linear, false);
      state.body.setAngvel(state.angular, false);
    }
  }

  groundDistanceM(feetM: THREE.Vector3, up: THREE.Vector3) {
    const origin = feetM.clone().addScaledVector(up, 2), down = up.clone().negate();
    const cast = (point: THREE.Vector3) => this.world.castRay(
      new RAPIER.Ray(point, down), 10000, true, undefined, undefined, this.collider);
    const hit = cast(origin);
    if (hit) return hit.timeOfImpact - 2;
    // An exact ray through a shared trimesh vertex may miss every adjoining
    // triangle in Rapier. Symmetric 10 µm tangent rays still sample the actual
    // collider, without moving the saved pose or substituting analytic terrain.
    if (!this.terrainPatch) return Number.POSITIVE_INFINITY;
    let total = 0, hits = 0;
    for (const direction of [this.terrainPatch.right, this.terrainPatch.forward]) for (const sign of [-1, 1]) {
      const adjacent = cast(origin.clone().addScaledVector(direction, sign * GROUND_RAY_EDGE_BIAS_M));
      if (adjacent) { total += adjacent.timeOfImpact - 2; hits++; }
    }
    return hits ? total / hits : Number.POSITIVE_INFINITY;
  }

  /** Query-only camera sphere sweep in the current floating metre frame. */
  constrainCamera(eyeM: THREE.Vector3, desiredM: THREE.Vector3, radiusM = CAMERA_COLLISION_RADIUS_M) {
    if (!this.terrainCollider) return desiredM.clone();
    const radius = Number.isFinite(radiusM) && radiusM > 0 ? radiusM : CAMERA_COLLISION_RADIUS_M;
    const sphere = new RAPIER.Ball(radius), rotation = { x: 0, y: 0, z: 0, w: 1 };
    const start = eyeM.clone();
    // The camera sphere extends slightly beyond the suit at eye height. Resolve
    // an initial overlap against the actual mesh, including a zero-length boom,
    // without moving the character or advancing Rapier/gameplay time.
    for (let i = 0; i < 4; i++) {
      const contact = this.terrainCollider.contactShape(sphere, start, rotation, CAMERA_TERRAIN_GAP_M);
      if (!contact || contact.distance >= CAMERA_TERRAIN_GAP_M) break;
      const normal = new THREE.Vector3().copy(contact.normal1);
      if (normal.lengthSq() < 1e-12) break;
      start.addScaledVector(normal.normalize(), CAMERA_TERRAIN_GAP_M - contact.distance + CAMERA_SWEEP_RETREAT_M);
    }
    const boom = desiredM.clone().sub(start), length = boom.length();
    if (length < 1e-8) return start;
    const hit = this.world.castShape(start, rotation, boom, sphere, CAMERA_TERRAIN_GAP_M, 1, true,
      undefined, undefined, this.collider, this.character,
      collider => collider.handle === this.terrainCollider!.handle);
    if (!hit) return desiredM.clone();
    const fraction = THREE.MathUtils.clamp(hit.time_of_impact - CAMERA_SWEEP_RETREAT_M / length, 0, 1);
    return start.addScaledVector(boom, fraction);
  }

  private refreshQueries() {
    // Rapier 0.19 builds scene queries during step. With no dynamic bodies, a zero-duration
    // refresh updates the broad phase without advancing gameplay time or changing velocity.
    const dt = this.world.timestep;
    this.world.timestep = 0;
    this.world.propagateModifiedBodyPositionsToColliders();
    this.world.step();
    this.world.timestep = dt;
  }

  dispose() { this.world.free(); }
}
