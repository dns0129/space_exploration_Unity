import * as THREE from "three";
import { createShip } from "./ship-model";
import type { ShipDynamics } from "./ship-dynamics";
import type { WalkingDynamics } from "./walking-dynamics";
import { METRES_PER_KILOMETRE } from "../shared/spatial-frame.mjs";
import { LANDING_CLEARANCE_KM } from "../shared/surface.mjs";

/** Metre-scale surface assets share the terrain depth buffer and the floating metre origin used by Rapier. */
export class ExplorerView {
  readonly group = new THREE.Group();
  private readonly astronaut = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly lander = createShip();
  private readonly beacon: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private stride = 0;
  private photoMode = false;
  private readonly cameraRay = new THREE.Raycaster();
  private readonly previousShipLocalM = new THREE.Vector3();
  private hasLocalCamera = false;
  private movementHeading = new THREE.Quaternion();

  constructor() {
    this.group.name = "Surface explorer and boarding beacon";
    const suit = new THREE.MeshStandardMaterial({ color: "#e3e8e5", roughness: 0.65 });
    const joint = new THREE.MeshStandardMaterial({ color: "#253f4a", roughness: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: "#e69b46", roughness: 0.45 });
    const visor = new THREE.MeshStandardMaterial({ color: "#14323b", metalness: 0.72, roughness: 0.19,
      emissive: "#0d3341", emissiveIntensity: 0.4 });
    const lamp = new THREE.MeshBasicMaterial({ color: "#8ee8db" });
    const box = (parent: THREE.Group, size: [number, number, number], position: [number, number, number], material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position); parent.add(mesh); return mesh;
    };
    box(this.astronaut, [0.52, 0.6, 0.31], [0, 1.16, 0], suit);
    box(this.astronaut, [0.38, 0.45, 0.24], [0, 1.16, 0.25], joint);
    box(this.astronaut, [0.24, 0.16, 0.035], [0, 1.22, -0.18], accent);
    box(this.astronaut, [0.11, 0.045, 0.04], [0, 1.32, -0.18], lamp);
    box(this.astronaut, [0.48, 0.15, 0.3], [0, 0.83, 0], joint);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), suit);
    helmet.position.set(0, 1.65, 0); this.astronaut.add(helmet);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.245, 24, 16), visor);
    face.scale.set(0.92, 0.72, 0.64); face.position.set(0, 1.65, -0.16); this.astronaut.add(face);
    for (const side of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(side * 0.145, 0.81, 0);
      box(leg, [0.2, 0.55, 0.23], [0, -0.29, 0], suit);
      box(leg, [0.22, 0.13, 0.24], [0, -0.49, -0.01], joint);
      box(leg, [0.23, 0.2, 0.37], [0, -0.7, -0.065], joint);
      this.astronaut.add(leg); this.legs.push(leg);
      const arm = new THREE.Group(); arm.position.set(side * 0.36, 1.4, 0);
      box(arm, [0.2, 0.23, 0.25], [0, -0.04, 0], accent);
      box(arm, [0.17, 0.46, 0.19], [0, -0.3, 0], suit);
      box(arm, [0.18, 0.16, 0.2], [0, -0.58, 0], joint);
      this.astronaut.add(arm); this.arms.push(arm);
    }
    this.beacon = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.035, 6, 64), lamp);
    this.beacon.rotation.x = -Math.PI / 2;
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: "#111c20", transparent: true, opacity: 0.3, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.lander.gear.visible = true;
    this.lander.exhaust.visible = false;
    this.group.add(this.astronaut, this.lander.group, this.beacon, this.shadow);
    // The local sky and terrain composite in the transparent pass. Draw the
    // explorer after them, retaining depth writes so the terrain still occludes feet.
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => { material.transparent = true; });
    });
    this.group.visible = false;
  }

  setPhotoMode(active: boolean) {
    this.photoMode = active;
    this.beacon.visible = !active;
  }

  update(walker: WalkingDynamics, ship: ShipDynamics, camera: THREE.PerspectiveCamera,
      view: "first" | "third", dt: number, paused: boolean, immediate = false) {
    this.group.visible = walker.active;
    if (!walker.active) return;
    const up = walker.outward;
    const feet = walker.localPositionM.clone();
    const shipLocal = walker.localShipPositionM;
    // Translate the follow camera in the same operation as every physics body.
    // Interpolating across a rebase would otherwise draw a one-frame camera jump.
    if (this.hasLocalCamera && !immediate)
      camera.position.add(shipLocal.clone().sub(this.previousShipLocalM));
    this.previousShipLocalM.copy(shipLocal);
    this.hasLocalCamera = true;
    this.astronaut.position.copy(feet);
    this.astronaut.scale.setScalar(1);
    this.astronaut.visible = view === "third";
    const motion = walker.velocity.clone().projectOnPlane(up);
    if (motion.lengthSq() > 0.04) {
      this.movementHeading.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), motion, up));
      this.astronaut.quaternion.slerp(this.movementHeading, immediate ? 1 : 1 - Math.exp(-dt * 12));
    } else this.astronaut.quaternion.copy(walker.orientation);
    if (!paused) this.stride += dt * walker.speedMps * (walker.gravity < 3 ? 1.5 : 2.3);
    const step = walker.grounded ? Math.sin(this.stride) * Math.min(0.65, walker.speedMps * 0.1) : 0.18;
    this.legs.forEach((leg, i) => { leg.rotation.x = (i ? -1 : 1) * step; });
    this.arms.forEach((arm, i) => { arm.rotation.x = walker.grounded ? (i ? 1 : -1) * step * 0.7 : -0.45; });
    const shipUp = ship.environment.outward;
    const ground = shipLocal.clone().addScaledVector(shipUp, -LANDING_CLEARANCE_KM * METRES_PER_KILOMETRE);
    // Flight uses a deliberately enlarged hull. This deployable 24 m lander represents the surface airlock.
    const landerScale = 24 / this.lander.hullLength;
    this.lander.group.scale.setScalar(landerScale);
    this.lander.group.quaternion.copy(ship.orientation);
    this.lander.group.position.copy(ground).addScaledVector(shipUp, this.lander.landingFootOffset * landerScale);
    this.beacon.scale.setScalar(1);
    this.beacon.visible = !this.photoMode;
    this.beacon.position.copy(ground).addScaledVector(shipUp, 0.08);
    this.beacon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), shipUp);
    this.shadow.position.copy(feet).addScaledVector(up, (0.035 - walker.groundClearanceM));
    this.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
    this.shadow.scale.setScalar(1);
    this.shadow.visible = walker.groundClearanceM < 8;

    const look = walker.orientation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), walker.pitch));
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(look);
    const eye = feet.clone().addScaledVector(up, 1.65);
    const destination = view === "first" ? eye : eye.clone().addScaledVector(forward, -5).addScaledVector(up, 0.7);
    camera.position.lerp(destination, immediate || view === "first" ? 1 : 1 - Math.exp(-dt * 12));
    if (view === "third") {
      // Retract the follow camera before a landing strut or hull can cover the explorer.
      this.lander.group.updateWorldMatrix(true, true);
      const ray = camera.position.clone().sub(eye);
      const distance = ray.length();
      this.cameraRay.set(eye, ray.normalize());
      this.cameraRay.far = distance;
      const hit = this.cameraRay.intersectObject(this.lander.group, true).find(intersection => {
        let object: THREE.Object3D | null = intersection.object;
        while (object && object !== this.group) {
          if (!object.visible) return false;
          object = object.parent;
        }
        return true;
      });
      if (hit) camera.position.copy(eye).addScaledVector(ray, Math.max(0.35, hit.distance - 0.25));
    }
    // Resolve the final interpolated camera against the exact visible Rapier
    // triangles, including hills along the eye-to-camera boom. A separate
    // analytical floor cannot detect an intervening ridge or its triangle edges.
    camera.position.copy(walker.constrainCamera(eye, camera.position));
    camera.up.copy(up);
    camera.lookAt(eye.clone().addScaledVector(forward, 8));
    if (Math.abs(camera.fov - 65) > 0.01 || camera.near !== 0.03) {
      camera.fov = 65; camera.near = 0.03; camera.updateProjectionMatrix();
    }
  }
}
