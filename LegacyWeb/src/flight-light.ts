import * as THREE from "three";
import type { ShipDynamics } from "./ship-dynamics";
import { stellarDiskVisibility } from "./light-occlusion";

/** Optical light from the visible star and a velocity-dependent atmospheric bow shock. */
export class FlightLight {
  illumination = 1;
  readonly material = new THREE.ShaderMaterial({
    uniforms: {
      sunScreen: { value: new THREE.Vector2() },
      sunColor: { value: new THREE.Color() },
      glow: { value: 0 }, entry: { value: 0 }, time: { value: 0 }, aspect: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec2 sunScreen;
      uniform vec3 sunColor;
      uniform float glow, entry, time, aspect;
      varying vec2 vUv;
      void main() {
        vec2 p=(vUv-0.5)*vec2(aspect,1.0);
        vec2 light=(sunScreen-0.5)*vec2(aspect,1.0);
        vec2 d=p-light;
        // Smooth optical falloff has no hard ring or screen-sized light wash.
        float halo=exp(-dot(d,d)*48.0)*0.58+exp(-dot(d,d)*580.0)*0.85;
        float streak=exp(-d.y*d.y*42000.0)*exp(-d.x*d.x*48.0)*0.065;
        vec3 color=sunColor*(halo+streak)*glow;
        vec2 edge=abs(vUv*2.0-1.0);
        float shock=pow(max(edge.x,edge.y),7.0);
        float flow=sin(vUv.x*41.0+vUv.y*19.0-time*13.0)*0.5+0.5;
        float filament=pow(flow,5.0)*pow(max(edge.x,edge.y),16.0);
        color+=mix(vec3(1.0,0.1,0.015),vec3(0.32,0.64,1.0),shock)
          *(shock*0.25+filament*0.3)*entry;
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  });
  readonly mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  private readonly ray = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly cameraInverse = new THREE.Quaternion();
  private readonly perpendicular = new THREE.Vector3();

  constructor() {
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 950;
    this.mesh.visible = false;
  }

  update(ship: ShipDynamics, camera: THREE.PerspectiveCamera, sun: THREE.PointLight) {
    camera.updateMatrixWorld();
    if (!ship.activeBodies.some(body => body.kind === "star")) {
      this.illumination = 0;
      this.mesh.visible = false;
      this.material.uniforms.glow.value = 0;
      this.material.uniforms.entry.value = 0;
      return;
    }
    this.illumination = this.stellarVisibility(ship, this.origin, sun.position);
    const visibility = this.stellarVisibility(ship, camera.position, sun.position);
    this.projected.copy(this.ray).applyQuaternion(this.cameraInverse.copy(camera.quaternion).invert());
    const visible = visibility > 0 && this.projected.z < 0 && !ship.warping;
    this.projected.copy(sun.position).project(camera);
    const onScreen = 1-THREE.MathUtils.smoothstep(Math.max(Math.abs(this.projected.x),Math.abs(this.projected.y)),0.85,1.35);
    const env = ship.environment;
    const day = THREE.MathUtils.smoothstep(env.outward.dot(this.ray),-0.1,0.3);
    const atmosphere = env.body.atmosphereKm
      ? 1-THREE.MathUtils.smoothstep(env.altitudeKm,0,env.body.atmosphereKm) : 0;
    const speedKm = ship.velocity.length()*ship.config.unitsKm;
    const inwardKm = Math.max(0,-ship.velocity.dot(env.outward))*ship.config.unitsKm;
    const entry = env.body.atmosphereKm && !ship.warping && ship.landingPhase === "manual"
      ? THREE.MathUtils.smoothstep(speedKm,1,15)*THREE.MathUtils.smoothstep(inwardKm,0.5,5)
        *THREE.MathUtils.smoothstep(env.altitudeKm,3,18)*atmosphere : 0;
    const uniforms = this.material.uniforms;
    uniforms.sunScreen.value.set(this.projected.x*0.5+0.5,this.projected.y*0.5+0.5);
    uniforms.sunColor.value.copy(sun.color);
    uniforms.glow.value = visible ? visibility*onScreen*0.1*(1-atmosphere*day*0.65) : 0;
    uniforms.entry.value = entry;
    uniforms.time.value = ship.elapsed;
    uniforms.aspect.value = camera.aspect;
    this.mesh.visible = uniforms.glow.value > 0.001 || entry > 0.001;
  }

  private stellarVisibility(ship: ShipDynamics, origin: THREE.Vector3, star: THREE.Vector3) {
    this.ray.copy(star).sub(origin);
    const distance = this.ray.length();
    this.ray.normalize();
    // The active source is selected by its position, including binary-star systems.
    const source = ship.activeBodies.find(body => body.kind === "star"
      && this.center.fromArray(body.position).sub(ship.position).distanceTo(star) < 1e-6);
    const angularRadius = Math.asin(Math.min(1, (source?.radius ?? distance * 0.00465) / distance));
    let visibility = 1;
    for (const body of ship.activeBodies) {
      if (body.kind === "star") continue;
      this.center.fromArray(body.position).sub(ship.position).sub(origin);
      const along = this.center.dot(this.ray);
      if (along <= 0 || along >= distance) continue;
      const bodyDistance = this.center.length();
      const separation = Math.atan2(this.perpendicular.copy(this.center).cross(this.ray).length(), along);
      const blockerRadius = Math.asin(Math.min(1, body.radius / bodyDistance));
      visibility = Math.min(visibility, stellarDiskVisibility(angularRadius, blockerRadius, separation));
      if (visibility === 0) break;
    }
    return visibility;
  }
}
