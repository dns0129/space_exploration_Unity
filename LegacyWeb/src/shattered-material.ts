import * as THREE from "three";
import { PROCEDURAL_DETAIL_WIDTH } from "./procedural-body";
import { SHATTERED_FRACTURE_GLSL } from "./shattered-geometry";
import { SHATTERED_LAVA_GLSL } from "./shattered-lava";

type ShaderSources = { vertex: string; noise: string; atmosphere: string };

/** Continuous rock fields shared by the globe, curved shell fragments and cut walls. */
export function createShatteredMaterial(uniforms: Record<string, THREE.IUniform>,
  sources: ShaderSources, small: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: sources.vertex.replace("void main()", "attribute float aShell; attribute vec3 aSourcePosition; varying float vShell; void main()")
      .replace("vUv = uv;", "vUv = uv; vShell = aShell;")
      .replace("vLocalPosition = position;", "vLocalPosition = aSourcePosition;"),
    uniforms: { ...uniforms, rockSeed: { value: small ? 37.91 : 11.43 },
      isSatellite: { value: small ? 1 : 0 }, rockDetailEnabled: { value: 1 },
      rockDetailLimit: { value: PROCEDURAL_DETAIL_WIDTH } },
    side: THREE.DoubleSide,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      uniform float uTime, rockSeed, isSatellite, bodyRadius, rockDetailEnabled, rockDetailLimit;
      uniform vec3 sunDirection;
      varying vec2 vUv;
      varying vec3 vLocalPosition, vWorldPosition, vNormal, vAxisX, vAxisY, vAxisZ;
      varying float vShell;
      ${sources.noise}
      ${SHATTERED_FRACTURE_GLSL}

      // Analytic noise derivatives keep magnified grains smooth and stable.
      vec4 rockNoiseGradient(vec3 x) {
        vec3 i = floor(x), f = fract(x);
        vec3 u = f*f*(3.0-2.0*f), du = 6.0*f*(1.0-f);
        float a=hash(i), b=hash(i+vec3(1,0,0)), c=hash(i+vec3(0,1,0)), d=hash(i+vec3(1,1,0));
        float e=hash(i+vec3(0,0,1)), g=hash(i+vec3(1,0,1)), h=hash(i+vec3(0,1,1)), k=hash(i+vec3(1,1,1));
        float k1=b-a, k2=c-a, k3=e-a, k4=a-b-c+d, k5=a-c-e+h, k6=a-b-e+g;
        float k7=-a+b+c-d+e-g-h+k;
        return vec4(a+k1*u.x+k2*u.y+k3*u.z+k4*u.x*u.y+k5*u.y*u.z+k6*u.z*u.x+k7*u.x*u.y*u.z,
          du*vec3(k1+k4*u.y+k6*u.z+k7*u.y*u.z, k2+k5*u.z+k4*u.x+k7*u.z*u.x,
            k3+k6*u.x+k5*u.y+k7*u.x*u.y));
      }
      vec4 rockMicrostructure(vec3 p, float footprint) {
        vec4 detail = vec4(0.0);
        float frequency=512.0/6.2831853, amplitude=1.0;
        for(int i=0; i<7; i++) {
          if(frequency > ${(PROCEDURAL_DETAIL_WIDTH / (Math.PI * 2) * 1.00001).toFixed(7)}) break;
          if(frequency*6.2831853 > rockDetailLimit*1.00001) break;
          float weight=clamp(1.5-footprint*frequency*2.0,0.0,1.0)*rockDetailEnabled;
          if(weight>0.0) {
            vec4 n=rockNoiseGradient(p*frequency+rockSeed+float(i)*17.31);
            detail+=vec4(n.x-0.5,n.yzw)*weight*amplitude;
          }
          frequency*=2.0; amplitude*=0.80;
        }
        return detail;
      }
      // Voronoi borders form branched rock plates rather than concentric contours.
      vec2 plateBorder(vec3 p) {
        vec3 cell=floor(p), local=fract(p);
        float nearest=8.0, second=8.0;
        for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
          vec3 offset=vec3(float(x),float(y),float(z)), q=cell+offset;
          vec3 point=offset+vec3(hash(q+7.7),hash(q+31.1),hash(q+68.3))-local;
          float distance=dot(point,point);
          if(distance<nearest) {second=nearest;nearest=distance;}
          else second=min(second,distance);
        }
        return vec2(sqrt(second)-sqrt(nearest),sqrt(nearest));
      }
      ${SHATTERED_LAVA_GLSL}
      vec3 rockBRDF(vec3 base, vec3 n, vec3 light, vec3 view, float roughness, float metal) {
        vec3 halfVector=normalize(light+view);
        float nl=max(dot(n,light),0.0), nv=max(dot(n,view),0.001);
        float nh=max(dot(n,halfVector),0.0), vh=max(dot(view,halfVector),0.0);
        float a=roughness*roughness, a2=a*a;
        float denominator=nh*nh*(a2-1.0)+1.0;
        float distribution=a2/(3.14159265*denominator*denominator+0.0001);
        float k=(roughness+1.0)*(roughness+1.0)/8.0;
        float geometry=(nl/(nl*(1.0-k)+k))*(nv/(nv*(1.0-k)+k));
        vec3 f0=mix(vec3(0.022),base,metal);
        vec3 fresnel=f0+(1.0-f0)*pow(1.0-vh,5.0);
        vec3 specular=distribution*geometry*fresnel/max(4.0*nl*nv,0.001);
        return ((1.0-fresnel)*(1.0-metal)*base+specular*1.15)*pow(nl,1.08)*1.6;
      }
      void main() {
        vec3 p=vLocalPosition, radial=normalize(p);
        float footprint=max(length(dFdx(p)),length(dFdy(p)));
        vec3 view=normalize(cameraPosition-vWorldPosition);
        vec3 viewLocal=vec3(dot(view,vAxisX),dot(view,vAxisY),dot(view,vAxisZ));
        float innerMantle=1.0-smoothstep(0.04,0.16,vShell);
        vec4 lava=vec4(0.0);
        if(innerMantle>0.5) lava=moltenBasalt(p,viewLocal,footprint);
        float province=fbm(radial*2.8+vec3(rockSeed,18.0,5.0));
        float iron=fbm(radial*5.2+vec3(4.0,rockSeed,51.0));
        float mineral=fbm(radial*9.0+vec3(67.0,2.0,rockSeed));
        float grit=fbm(p*95.0+rockSeed);
        vec3 charcoal=vec3(0.035,0.047,0.045), limestone=vec3(0.24,0.26,0.21);
        vec3 base=mix(charcoal,limestone,smoothstep(0.34,0.61,province));
        base=mix(base,vec3(0.19,0.063,0.039),smoothstep(0.43,0.64,iron)*0.72);
        base=mix(base,vec3(0.19,0.24,0.054),smoothstep(0.57,0.68,mineral)*0.45);
        float fault=shatteredFault(radial,isSatellite);
        float damage=shatteredDamage(radial,isSatellite);
        vec3 tectonicWarp=vec3(fbm(p*12.0+rockSeed),fbm(p*13.0+42.0),fbm(p*11.0+79.0));
        vec2 plates=plateBorder(radial*18.0+tectonicWarp*1.8+rockSeed);
        float border=plates.x;
        float aa=min(fwidth(border),0.04);
        float cracked=1.0-smoothstep(0.005,0.018+aa,border);
        float brokenVeins=smoothstep(0.32,0.66,fbm(p*28.0+rockSeed));
        float cracks=cracked*brokenVeins;
        float nearRift=1.0-smoothstep(0.015,0.19,fault);
        float charred=damage*(0.45+nearRift*0.42);
        base=mix(base,vec3(0.016,0.020,0.018)*(0.65+mineral),charred);
        base*=mix(1.0,0.22,cracks*(0.12+damage*0.88));
        float strata=0.5+0.5*sin(length(p)*780.0+noise3(radial*23.0)*7.0);
        float flakes=fbm(p*43.0+tectonicWarp*4.0+rockSeed);
        float pits=(1.0-smoothstep(0.08,0.26,plates.y))*smoothstep(0.35,0.55,noise3(p*57.0));
        base*=0.48+smoothstep(0.24,0.72,flakes)*0.56+grit*0.30+strata*0.10;
        base*=1.0-pits*0.5;
        vec4 micro=rockMicrostructure(p,footprint);
        base*=clamp(1.0+micro.x*1.15,0.25,1.7);

        vec3 n=normalize(vNormal);
        if(!gl_FrontFacing) n=-n;
        // Surface-gradient relief respects the kilometre-scaled flight model.
        vec3 dx=dFdx(vWorldPosition)/bodyRadius, dy=dFdy(vWorldPosition)/bodyRadius;
        vec3 rx=cross(dy,n), ry=cross(n,dx);
        float det=dot(dx,rx);
        float height=grit*0.0011+flakes*0.0015-cracks*0.0007-pits*0.0011+strata*0.00017
          +lava.a*innerMantle*0.0011;
        vec3 gradient=sign(det)*(dFdx(height)*rx+dFdy(height)*ry);
        n=normalize(max(abs(det),0.000000000001)*n-gradient);
        vec3 microSlope=vAxisX*micro.y+vAxisY*micro.z+vAxisZ*micro.w;
        n=normalize(n-(microSlope-n*dot(n,microSlope))*0.25);
        vec3 light=normalize(sunDirection);
        float shell=smoothstep(0.35,0.9,vShell);
        float cut=1.0-shell;
        float depth=1.0-smoothstep(0.925,0.98,length(p));
        float occlusion=mix(0.52,1.0,smoothstep(0.005,0.06,fault))*mix(0.65,1.0,shell);
        vec3 cutRock=mix(vec3(0.008,0.009,0.008),vec3(0.032,0.027,0.021),flakes)
          *(0.66+strata*0.25+micro.x*0.65);
        base=mix(base,cutRock,cut);
        float roughness=clamp(0.97-mineral*0.07+micro.x*0.035,0.88,1.0);
        vec3 color=rockBRDF(base,n,light,view,roughness,0.0)*occlusion;
        color+=base*0.018*occlusion;

        color+=lava.rgb*innerMantle;
        float wallEmbers=cut*(1.0-innerMantle)*nearRift*depth;
        color+=vec3(0.12,0.006,0.0005)*wallEmbers*(0.3+cracks*0.7);
        color+=vec3(0.32,0.009,0.0005)*shell*cracks*damage*nearRift*0.12;
        #include <logdepthbuf_fragment>
        gl_FragColor=vec4(max(color,vec3(0.0)),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
