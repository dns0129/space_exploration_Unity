import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { StationVisitState } from "../shared/flight-state.mjs";
import { STATION_HELM, STATION_ROOMS, STATION_SPAWN, STATION_WALLS, stationWalkable, stationZone } from "../shared/station-layout.mjs";
import type { FlightInput } from "./ship-dynamics";
import { createShip } from "./ship-model";

const EYE_HEIGHT_M = 1.65;
const MAX_FOOT_HEIGHT_M = 2.4;
type Point = [number, number, number];

/** Separate metre-scale scene: the astronomical station never becomes a walkable planet. */
export class StationInterior {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(68, 1, 0.06, 2600);
  readonly positionM = new THREE.Vector3().fromArray(STATION_SPAWN);
  yaw = 0;
  pitch = 0;
  cameraView: "first" | "third" = "first";
  active = false;
  grounded = true;
  piloting = false;
  private readonly velocity = new THREE.Vector3();
  private readonly astronaut = new THREE.Group();
  private readonly limbs: THREE.Group[] = [];
  private readonly holograms: THREE.Object3D[] = [];
  private readonly textures = new Set<THREE.Texture>();
  private clock = 0;
  private gait = 0;
  private jumpHeld = false;
  private built = false;

  get speedMps() { return Math.hypot(this.velocity.x, this.velocity.z); }
  get distanceToShipM() { return this.positionM.distanceTo(new THREE.Vector3().fromArray(STATION_SPAWN)); }
  get distanceToHelmM() { return this.positionM.distanceTo(new THREE.Vector3().fromArray(STATION_HELM)); }
  get zone() { return stationZone(this.positionM); }

  enter(state?: StationVisitState) {
    if (!this.built) this.build();
    const position = state?.positionM;
    if (position && stationWalkable(position) && position[1] >= 0 && position[1] <= MAX_FOOT_HEIGHT_M)
      this.positionM.fromArray(position);
    else this.positionM.fromArray(STATION_SPAWN);
    this.yaw = Number.isFinite(state?.yaw) ? state!.yaw : 0;
    this.pitch = THREE.MathUtils.clamp(Number.isFinite(state?.pitch) ? state!.pitch : 0, -1.25, 1.25);
    this.cameraView = state?.camera === "third" ? "third" : "first";
    this.velocity.set(0, 0, 0);
    this.grounded = this.positionM.y <= 0.001;
    this.jumpHeld = false;
    this.active = true;
    this.piloting = state?.piloting ?? false;
    this.updateCamera();
  }

  leave() {
    this.active = false;
    this.piloting = false;
    this.velocity.set(0, 0, 0);
    this.jumpHeld = false;
  }

  snapshot(): StationVisitState | undefined {
    return this.active ? { bodyId: "earth-station", positionM: this.positionM.toArray(),
      yaw: this.yaw, pitch: this.pitch, camera: this.cameraView, vessel: true, piloting: this.piloting } : undefined;
  }

  takeHelm() {
    this.piloting = true;
    this.velocity.set(0, 0, 0);
    this.updateCamera();
  }
  releaseHelm() {
    this.piloting = false;
    this.positionM.fromArray(STATION_HELM);
    this.yaw = 0;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.jumpHeld = false;
    this.updateCamera();
  }

  setCamera(view: "first" | "third") {
    this.cameraView = view;
    this.updateCamera();
  }

  resize(width: number, height: number) {
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  step(delta: number, input: FlightInput) {
    if (!this.active || this.piloting || !Number.isFinite(delta)) return;
    const duration = THREE.MathUtils.clamp(delta, 0, 0.25);
    if (!duration) return;
    if (input.brake && !this.jumpHeld && this.grounded) {
      this.velocity.y = 4.5;
      this.grounded = false;
    }
    this.jumpHeld = input.brake;
    for (let remaining = duration; remaining > 1e-9; remaining -= 1 / 120) {
      const dt = Math.min(remaining, 1 / 120);
      this.yaw += THREE.MathUtils.clamp(input.yaw - input.mouseX, -1, 1) * 1.8 * dt;
      this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
      this.pitch = THREE.MathUtils.clamp(this.pitch + (input.pitch - input.mouseY) * 1.3 * dt, -1.25, 1.25);
      const forward = THREE.MathUtils.clamp(input.throttle, -1, 1);
      const strafe = THREE.MathUtils.clamp(input.strafe, -1, 1);
      const wish = new THREE.Vector3(strafe, 0, -forward).clampLength(0, 1)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).multiplyScalar(input.boost ? 5.5 : 2.8);
      const response = 1 - Math.exp(-dt * (this.grounded ? 9 : 3));
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, wish.x, response);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, wish.z, response);
      // Fixed small substeps and axis sliding prevent tunnelling at doors and furniture.
      const next = this.positionM.clone();
      next.x += this.velocity.x * dt;
      if (stationWalkable(next)) this.positionM.x = next.x;
      else this.velocity.x = 0;
      next.copy(this.positionM);
      next.z += this.velocity.z * dt;
      if (stationWalkable(next)) this.positionM.z = next.z;
      else this.velocity.z = 0;
      this.velocity.y -= 9.81 * dt;
      this.positionM.y = Math.min(MAX_FOOT_HEIGHT_M, this.positionM.y + this.velocity.y * dt);
      if (this.positionM.y >= MAX_FOOT_HEIGHT_M && this.velocity.y > 0) this.velocity.y = 0;
      this.grounded = this.positionM.y <= 0;
      if (this.grounded) {
        this.positionM.y = 0;
        this.velocity.y = 0;
      }
      this.clock += dt;
      this.gait += this.speedMps * dt * 2.2;
    }
    this.updateCamera();
  }

  updateCamera() {
    if (this.piloting) {
      this.camera.position.set(0, 1.8, -36.8);
      this.camera.quaternion.identity();
      this.astronaut.visible = false;
      this.camera.updateMatrixWorld();
      return;
    }
    const head = this.positionM.clone().add(new THREE.Vector3(0, EYE_HEIGHT_M, 0));
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    this.camera.quaternion.copy(rotation);
    if (this.cameraView === "first") {
      this.camera.position.copy(head);
      // A subtle stride keeps the horizon steady and never changes the collision capsule.
      if (this.grounded) this.camera.position.y += Math.sin(this.gait * 2) * 0.018 * Math.min(1, this.speedMps);
    } else {
      const backward = new THREE.Vector3(0, 0.45, 4.2).applyQuaternion(rotation);
      const desired = head.clone().add(backward);
      // Sweep the complete camera segment, including walls and furniture corners.
      let fraction = 1;
      const samples = Math.ceil(backward.length() / 0.12);
      for (let sample = 1; sample <= samples; sample++) {
        const test = head.clone().lerp(desired, sample / samples);
        const room = STATION_ROOMS.find(candidate => test.x >= candidate.minX && test.x <= candidate.maxX
          && test.z >= candidate.minZ && test.z <= candidate.maxZ);
        if (!stationWalkable(test, 0.2) || test.y < 0.25 || test.y > (room?.height ?? 4.2) - 0.22) {
          fraction = Math.max(0, (sample - 1) / samples);
          break;
        }
      }
      this.camera.position.copy(head).lerp(desired, fraction);
      this.camera.lookAt(head.clone().add(new THREE.Vector3(0, -0.2, -5).applyQuaternion(rotation)));
    }
    this.astronaut.visible = this.active && this.cameraView === "third";
    this.astronaut.position.copy(this.positionM);
    this.astronaut.rotation.y = this.yaw;
    for (let index = 0; index < this.limbs.length; index++) {
      this.limbs[index].rotation.x = Math.sin(this.gait + (index % 2) * Math.PI)
        * Math.min(0.55, this.speedMps * 0.12) * (this.grounded ? 1 : 0.25) * (index < 2 ? 1 : -0.7);
    }
    for (let index = 0; index < this.holograms.length; index++)
      this.holograms[index].rotation.y = this.clock * (index % 2 ? -0.12 : 0.08);
    this.camera.updateMatrixWorld();
  }

  private panelTexture(title: string, subtitle: string, diagram = false) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = diagram ? 512 : 256;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#051825";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#123a4b");
    gradient.addColorStop(1, "#07111e");
    context.fillStyle = gradient;
    context.fillRect(5, 5, canvas.width - 10, canvas.height - 10);
    context.strokeStyle = "#4bc9dd";
    context.lineWidth = 3;
    context.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);
    context.fillStyle = "#80e6ee";
    context.font = "600 50px sans-serif";
    context.fillText(title, 48, 86);
    context.font = "26px sans-serif";
    context.fillStyle = "#b8ccd7";
    context.fillText(subtitle, 50, 130);
    if (diagram) {
      context.strokeStyle = "#245d72";
      context.lineWidth = 1;
      for (let x = 48; x < 1000; x += 38) {
        context.beginPath(); context.moveTo(x, 165); context.lineTo(x, 440); context.stroke();
      }
      for (let y = 165; y < 450; y += 34) {
        context.beginPath(); context.moveTo(48, y); context.lineTo(970, y); context.stroke();
      }
      context.strokeStyle = "#60e7ee";
      for (const radius of [55, 86, 124]) {
        context.beginPath(); context.ellipse(245, 304, radius * 1.3, radius * 0.75, -0.3, 0, Math.PI * 2); context.stroke();
      }
      context.fillStyle = "#6ddff3";
      context.beginPath(); context.arc(245, 304, 28, 0, Math.PI * 2); context.fill();
      context.beginPath();
      for (let x = 475; x < 958; x += 4) {
        const y = 297 + Math.sin(x * 0.02) * 35 + Math.sin(x * 0.078) * 13;
        if (x === 475) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke();
      context.fillStyle = "#dcaf69";
      context.font = "22px monospace";
      context.fillText("SOLAR ARRAY  100%   /   LIFE SUPPORT  ONLINE", 478, 394);
      context.fillText("EARTH ORBIT   2400 KM   /   DOCK 01  SECURED", 478, 429);
    } else {
      context.fillStyle = "#dbb06c";
      context.fillRect(48, 175, 100, 6);
      context.fillStyle = "#3e8197";
      context.fillRect(165, 175, 800, 2);
      context.font = "19px monospace";
      context.fillStyle = "#7ca2b2";
      context.fillText("A U R O R A   /   S T A R S H I P   /   B R I D G E", 48, 220);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.add(texture);
    return texture;
  }

  /** The control-room projection is decorative; window views use the orbital scene. */
  private hologramMaterial() {
    const material = new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vSphere; varying vec3 vNormal; varying vec3 vView; varying vec2 vUv;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){ vUv=uv; vSphere=normalize(position); vNormal=normalize(normalMatrix*normal);
          vec4 p=modelViewMatrix*vec4(position,1.0); vView=-p.xyz; gl_Position=projectionMatrix*p;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        varying vec3 vSphere,vNormal,vView; varying vec2 vUv;
        #include <logdepthbuf_pars_fragment>
        float hash(vec3 p){p=fract(p*0.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
        float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1)),f.x),f.y),f.z);}
        float fbm(vec3 p){return noise(p)*0.5+noise(p*2.03)*0.25+noise(p*4.01)*0.125+noise(p*8.07)*0.0625;}
        void main(){
          #include <logdepthbuf_fragment>
          vec3 n=normalize(vSphere); vec3 color;
          float land=fbm(n*3.6+vec3(3.0,7.1,2.0));
          float continents=smoothstep(0.48,0.51,land); float desert=smoothstep(0.55,0.69,fbm(n*6.0+7.0));
          vec3 terrain=mix(vec3(0.085,0.25,0.15),vec3(0.53,0.42,0.24),desert);
          color=mix(vec3(0.015,0.11,0.3),terrain,continents);
          float ice=smoothstep(0.8,0.94,abs(n.y)+noise(n*18.0)*0.06);color=mix(color,vec3(0.84,0.91,0.92),ice);
          float cloud=smoothstep(0.54,0.66,fbm(n*9.0+vec3(8.0,2.0,11.0)));
          color=mix(color,vec3(0.86,0.92,0.95),cloud*0.85);
          float sunlight=smoothstep(-0.2,0.45,dot(n,normalize(vec3(-0.8,0.5,-0.25))));
          color*=0.1+sunlight*1.15;
          float rim=pow(1.0-max(0.0,dot(normalize(vNormal),normalize(vView))),3.5);
          color+=vec3(0.09,0.42,0.8)*rim*0.8;
          float grid=pow(abs(sin(atan(n.z,n.x)*18.0)),180.0)+pow(abs(sin(asin(clamp(n.y,-1.0,1.0))*18.0)),180.0);
          color=color*0.4+vec3(0.07,0.7,0.95)*(0.45+grid*0.5);
          gl_FragColor=vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    return material;
  }

  private build() {
    this.built = true;
    // Preserve the actual astronomical background rendered before this local deck.
    this.scene.background = null;
    this.scene.add(new THREE.HemisphereLight(0xcce6ff, 0x172c45, 1.65));
    const sunlight = new THREE.DirectionalLight(0xffdfb0, 2.1);
    sunlight.position.set(30, 20, -12);
    this.scene.add(sunlight);
    const fill = new THREE.DirectionalLight(0x5daaff, 0.7);
    fill.position.set(-10, 10, 24);
    this.scene.add(fill);
    for (const [point, color, intensity] of [
      [[0, 4.8, 22], 0xc4e6ff, 115], [[0, 3.4, -30], 0x68d9ff, 95], [[18, 3.6, -3], 0xaccfff, 65],
    ] as [Point, number, number][]) {
      const light = new THREE.PointLight(color, intensity, 35, 2);
      light.position.fromArray(point);
      this.scene.add(light);
    }
    const metal = new THREE.MeshStandardMaterial({ color: 0x4e6476, metalness: 0.72, roughness: 0.44 });
    const pale = new THREE.MeshStandardMaterial({ color: 0x8796a6, metalness: 0.4, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x121f2c, metalness: 0.67, roughness: 0.56 });
    const floor = new THREE.MeshStandardMaterial({ color: 0x293b4b, metalness: 0.5, roughness: 0.62 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xb18b55, metalness: 0.62, roughness: 0.4 });
    const cyan = new THREE.MeshBasicMaterial({ color: 0x71edff, toneMapped: false });
    const amber = new THREE.MeshBasicMaterial({ color: 0xffc36b, toneMapped: false });
    const white = new THREE.MeshBasicMaterial({ color: 0xc5e8ff, toneMapped: false });
    const glazing = new THREE.MeshPhysicalMaterial({ color: 0x8fb9d1, roughness: 0.09, metalness: 0.15,
      transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
    const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const part = (geometry: THREE.BufferGeometry, material: THREE.Material, position: Point = [0, 0, 0], rotation: Point = [0, 0, 0]) => {
      const flat = geometry.index ? geometry.toNonIndexed() : geometry;
      flat.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().fromArray(position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
      if (flat !== geometry) geometry.dispose();
      const bucket = batches.get(material) ?? [];
      bucket.push(flat); batches.set(material, bucket);
    };
    const box = (size: Point, position: Point, material: THREE.Material, rotation: Point = [0, 0, 0]) =>
      part(new THREE.BoxGeometry(...size), material, position, rotation);
    const ring = (radius: number, thickness: number, position: Point, material: THREE.Material, rotation: Point = [Math.PI / 2, 0, 0]) =>
      part(new THREE.TorusGeometry(radius, thickness, 6, 64), material, position, rotation);
    const panel = (title: string, subtitle: string, position: Point, size: [number, number], rotation: Point = [0, 0, 0], diagram = false) => {
      const material = new THREE.MeshBasicMaterial({ map: this.panelTexture(title, subtitle, diagram), toneMapped: false });
      part(new THREE.PlaneGeometry(...size), material, position, rotation);
    };
    for (const room of STATION_ROOMS) {
      const width = room.maxX - room.minX, length = room.maxZ - room.minZ;
      const x = (room.minX + room.maxX) / 2, z = (room.minZ + room.maxZ) / 2;
      box([width, 0.26, length], [x, -0.15, z], dark);
      for (let tileX = room.minX; tileX < room.maxX; tileX += 2) {
        for (let tileZ = room.minZ; tileZ < room.maxZ; tileZ += 2) {
          const tileWidth = Math.min(2, room.maxX - tileX), tileLength = Math.min(2, room.maxZ - tileZ);
          box([tileWidth - 0.035, 0.035, tileLength - 0.035], [tileX + tileWidth / 2, -0.0175, tileZ + tileLength / 2], floor);
        }
      }
      box([width, 0.22, length], [x, room.height + 0.11, z], dark);
      for (let ribZ = room.minZ + 1; ribZ <= room.maxZ; ribZ += 4) {
        box([width, 0.12, 0.3], [x, room.height - 0.06, ribZ], metal);
        for (const side of [-1, 1]) {
          const lightX = x + side * Math.min(width * 0.32, 4.5);
          box([0.32, 0.08, 2.8], [lightX, room.height - 0.1, ribZ + 0.75], white);
          box([0.65, 0.1, 3.1], [lightX, room.height - 0.04, ribZ + 0.75], dark);
        }
      }
    }
    for (const wall of STATION_WALLS) {
      const length = wall.to - wall.from;
      const center = (wall.from + wall.to) / 2;
      const position = (along: number, y: number, offset = 0): Point => wall.axis === "x"
        ? [wall.fixed + wall.inward * offset, y, along] : [along, y, wall.fixed + wall.inward * offset];
      const size = (span: number, height: number, thickness: number): Point => wall.axis === "x"
        ? [thickness, height, span] : [span, height, thickness];
      const window = wall.roomId === "observation" && wall.axis === "x" && wall.fixed === 27
        || wall.roomId === "control" && wall.axis === "z" && wall.fixed === -40
        || wall.roomId === "docking" && wall.axis === "z" && wall.fixed === 34;
      if (window) {
        box(size(length, 0.9, 0.38), position(center, 0.45), metal);
        box(size(length, 0.5, 0.38), position(center, wall.height - 0.25), metal);
        box(size(length - 0.3, wall.height - 1.4, 0.06), position(center, (wall.height + 0.4) / 2), glazing);
        for (let along = wall.from; along <= wall.to; along += 4) {
          box(size(0.2, wall.height, 0.4), position(along, wall.height / 2), metal);
          box(size(0.035, wall.height - 0.5, 0.04), position(along, wall.height / 2, 0.24), cyan);
        }
        box(size(length, 0.025, 0.05), position(center, 1, 0.22), cyan);
      } else {
        box(size(length, wall.height, 0.32), position(center, wall.height / 2, -0.08), dark);
        for (let along = wall.from; along < wall.to; along += 2.8) {
          const span = Math.min(2.8, wall.to - along);
          box(size(span - 0.07, wall.height - 0.75, 0.06), position(along + span / 2, wall.height / 2, 0.13), pale);
          box(size(span - 0.3, 0.1, 0.1), position(along + span / 2, 0.68, 0.19), dark);
          box(size(span - 0.6, 0.02, 0.03), position(along + span / 2, wall.height - 0.64, 0.2), cyan);
        }
      }
      box(size(length, 0.09, 0.15), position(center, 0.13, 0.2), wall.roomId === "docking" ? amber : cyan);
      box(size(length, 0.18, 0.3), position(center, wall.height - 0.15, 0.15), metal);
    }
    // A straight, unobstructed luminous spine connects all three occupied decks.
    for (const side of [-1, 1]) {
      box([0.07, 0.012, 51], [side * 1.1, 0.012, -1.5], cyan);
      box([0.18, 0.008, 51], [side * 1.1, 0.006, -1.5], dark);
    }
    for (let z = -15; z < 23; z += 4) {
      box([0.11, 0.016, 0.7], [-0.23, 0.018, z], cyan, [0, -0.62, 0]);
      box([0.11, 0.016, 0.7], [0.23, 0.018, z], cyan, [0, 0.62, 0]);
    }
    for (const z of [-18, 12]) {
      for (const side of [-1, 1]) {
        box([0.25, 4.1, 0.4], [side * 2.88, 2.05, z], metal);
        box([0.055, 3.8, 0.06], [side * 2.72, 2.05, z + 0.25], cyan);
      }
      box([5.85, 0.35, 0.5], [0, 4, z], metal);
      const ceiling = z === 12 ? 6 : 4.8;
      box([6, ceiling - 4.2, 0.32], [0, (ceiling + 4.2) / 2, z], dark);
    }
    box([0.32, 0.6, 24], [3, 4.5, -2], dark);
    panel("02 / COMMAND · 驾驶室", "← OBSERVATORY  /  观测舱 →", [0, 3.45, -17.7], [4.5, 1.125]);
    panel("01 / DOCKING · 停泊舱", "RETURN TO SHIP  /  返回飞船", [0, 3.4, 12.3], [4.5, 1.125], [0, Math.PI, 0]);
    panel("03 / OBSERVATORY · 观测舱", "SUNLIT EARTH  /  向阳面地球", [3.3, 3.65, -2], [5.5, 1.375], [0, -Math.PI / 2, 0]);
    // Parked survey vessel and its recessed berth, with an accessible return pad.
    box([10.3, 0.03, 10.2], [-6.2, 0.02, 25], dark);
    for (const side of [-1, 1]) {
      box([0.07, 0.025, 10.2], [-6.2 + side * 5.25, 0.048, 25], amber);
      box([10.5, 0.025, 0.07], [-6.2, 0.048, 25 + side * 5.1], amber);
      for (let stripe = 0; stripe < 8; stripe++) box([0.24, 0.02, 0.5], [-6.2 + side * 4.5, 0.052, 21.3 + stripe], amber, [0, 0.55, 0]);
    }
    const ship = createShip();
    ship.group.scale.setScalar(4.8);
    ship.group.position.set(-6.2, ship.landingFootOffset * 4.8, 25);
    ship.gear.visible = true;
    ship.exhaust.visible = false;
    this.scene.add(ship.group);
    ring(1.45, 0.035, [0, 0.06, 24], amber);
    ring(1.22, 0.012, [0, 0.064, 24], cyan);
    panel("DOCK 01 / VOYAGER", "SECURED · 飞船已停泊", [-6.2, 2.7, 33.78], [7, 1.75], [0, Math.PI, 0]);
    panel("TERRA · 远航星舰", "EARTH / SUNLIT ORBIT   |   2400 KM", [9.4, 2.65, 12.25], [7, 1.75]);
    for (const x of [6, 9.5, 12]) {
      box([1.3, 1.3, 1.5], [x, 0.65, 30.8], metal);
      box([1.1, 0.035, 1.3], [x, 1.31, 30.8], copper);
      box([0.95, 0.1, 0.03], [x, 0.9, 30.04], cyan);
    }
    // The command deck: central holographic globe plus two banks of tilted consoles.
    box([6.4, 0.36, 5.8], [0, 0.18, -30.5], dark);
    box([5.4, 0.8, 4.8], [0, 0.78, -30.5], metal);
    box([6, 0.16, 5.4], [0, 1.24, -30.5], dark);
    for (const side of [-1, 1]) {
      box([0.035, 0.04, 5.4], [side * 2.95, 1.35, -30.5], cyan);
      box([6, 0.04, 0.035], [0, 1.35, -30.5 + side * 2.65], cyan);
    }
    ring(2.05, 0.035, [0, 1.35, -30.5], cyan);
    const holo = new THREE.Group();
    holo.position.set(0, 2.9, -30.5);
    holo.add(new THREE.Mesh(new THREE.SphereGeometry(1.35, 64, 40), this.hologramMaterial()));
    const orbital = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.012, 6, 96), cyan);
    orbital.rotation.x = Math.PI / 2.3;
    holo.add(orbital);
    this.scene.add(holo); this.holograms.push(holo);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2, 1.6, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x1cbbdd, transparent: true, opacity: 0.055,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.set(0, 2.15, -30.5); this.scene.add(beam);
    const consoleMaterial = new THREE.MeshBasicMaterial({ map: this.panelTexture("FLIGHT TELEMETRY", "航道监控 / 生命保障", true), toneMapped: false });
    for (const side of [-1, 1]) {
      for (const z of [-24, -29, -34.5]) {
        box([3.7, 0.9, 3.2], [side * 11.1, 0.45, z], dark);
        box([3.5, 0.2, 2.9], [side * 11.1, 1.15, z], metal, [0, 0, side * 0.25]);
        part(new THREE.PlaneGeometry(2.7, 2.2), consoleMaterial, [side * 11.1, 1.3, z], [-Math.PI / 2, 0, side * 0.15]);
        box([0.08, 0.06, 3], [side * 9.4, 1.05, z], cyan);
      }
    }
    // Helm below the forward pressure glazing, approached around the hologram table.
    box([4.6, 0.85, 0.9], [0, 0.425, -38.7], metal);
    panel("TERRA / HELM", "E 接管驾驶 · X 离开驾驶座", [0, 1.05, -38.15], [4.2, 0.8]);
    ring(0.7, 0.025, [0, 0.04, -36], amber);
    panel("SECTOR 02 / COMMAND", "ACTIVE CREW DECK · 中央指挥", [-13.77, 3.3, -20.5], [3.5, 0.875], [0, Math.PI / 2, 0]);
    // Panoramic observation lounge: clear glazing, deep structural mullions and quiet seating.
    box([10, 0.38, 2], [16, 0.38, 7.5], dark);
    box([10, 0.22, 1.6], [16, 0.69, 7.3], pale);
    box([10, 0.75, 0.3], [16, 1, 8.3], metal);
    box([9.5, 0.03, 0.03], [16, 1.35, 8.1], cyan);
    panel("EARTH / 地球观测", "2400 KM · SUNLIT ORBIT · PANORAMIC DECK", [14, 3.7, -13.75], [12, 1.1]);
    for (let z = -10; z <= 6; z += 4) {
      box([0.1, 0.012, 2.2], [25.5, 0.025, z], cyan);
      box([0.8, 0.012, 0.035], [24.9, 0.025, z], cyan);
    }
    // The entire rigid architecture is drawn once per material.
    for (const [material, geometries] of batches) {
      const geometry = mergeGeometries(geometries);
      geometries.forEach(item => item.dispose());
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "Aurora interior material batch";
        this.scene.add(mesh);
      }
    }
    this.buildExterior();
    this.buildAstronaut();
  }

  private buildExterior() {
    // Nearby nacelles and radiator armor share the cabin's rigid metre frame.
    const hardware = new THREE.MeshStandardMaterial({ color: 0x586b7a, metalness: 0.85, roughness: 0.36 });
    const drive = new THREE.MeshBasicMaterial({ color: 0x71edff, toneMapped: false });
    for (const side of [-1, 1]) {
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.6, 30, 24), hardware);
      nacelle.rotation.x = Math.PI / 2;
      nacelle.position.set(side * 34, -1.5, 27);
      this.scene.add(nacelle);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.2, 24), drive);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(side * 34, -1.5, 42.2);
      this.scene.add(nozzle);
      const spar = new THREE.Mesh(new THREE.BoxGeometry(18, 1, 2), hardware);
      spar.position.set(side * 26, -2, 27);
      this.scene.add(spar);
    }
  }

  private buildAstronaut() {
    const suit = new THREE.MeshStandardMaterial({ color: 0xd5dfdf, metalness: 0.2, roughness: 0.62 });
    const joint = new THREE.MeshStandardMaterial({ color: 0x172b40, metalness: 0.15, roughness: 0.72 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xc9914e, metalness: 0.25, roughness: 0.5 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x08283b, metalness: 0.85, roughness: 0.14, emissive: 0x082335 });
    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, position: Point, parent: THREE.Group = this.astronaut) => {
      const item = new THREE.Mesh(geometry, material); item.position.fromArray(position); parent.add(item); return item;
    };
    mesh(new THREE.CapsuleGeometry(0.235, 0.36, 5, 12), suit, [0, 1.13, 0]);
    mesh(new THREE.BoxGeometry(0.4, 0.31, 0.14), trim, [0, 1.25, -0.225]);
    mesh(new THREE.BoxGeometry(0.36, 0.44, 0.24), joint, [0, 1.15, 0.235]);
    mesh(new THREE.SphereGeometry(0.245, 24, 16), suit, [0, 1.63, 0]);
    const glass = mesh(new THREE.SphereGeometry(0.215, 24, 16), visor, [0, 1.65, -0.115]);
    glass.scale.set(0.98, 0.69, 0.52);
    mesh(new THREE.TorusGeometry(0.18, 0.04, 6, 24), joint, [0, 1.43, 0]).rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(side * 0.135, 0.77, 0); this.astronaut.add(leg); this.limbs.push(leg);
      mesh(new THREE.CapsuleGeometry(0.1, 0.42, 4, 10), suit, [0, -0.3, 0], leg);
      mesh(new THREE.BoxGeometry(0.21, 0.15, 0.3), joint, [0, -0.69, -0.035], leg);
      mesh(new THREE.CylinderGeometry(0.112, 0.112, 0.12, 10), trim, [0, -0.37, 0], leg);
    }
    for (const side of [-1, 1]) {
      const arm = new THREE.Group(); arm.position.set(side * 0.31, 1.32, 0); this.astronaut.add(arm); this.limbs.push(arm);
      mesh(new THREE.CapsuleGeometry(0.082, 0.34, 4, 10), suit, [0, -0.21, 0], arm);
      mesh(new THREE.SphereGeometry(0.085, 12, 8), joint, [0, -0.47, 0], arm);
    }
    this.astronaut.name = "Walking station astronaut";
    this.scene.add(this.astronaut);
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) materials.add(material);
      }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.textures.forEach(texture => texture.dispose());
    this.textures.clear();
    this.scene.clear();
    this.limbs.length = 0;
    this.holograms.length = 0;
    this.astronaut.clear();
    this.built = false;
    this.active = false;
    this.piloting = false;
  }
}
