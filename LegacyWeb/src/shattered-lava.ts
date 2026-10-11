/** Cooled basalt rafts above moving incandescent channels, with subsurface depth. */
export const SHATTERED_LAVA_GLSL = /* glsl */ `
  vec3 moltenCoordinates(vec3 p) {
    vec3 drift=vec3(uTime*0.0009,-uTime*0.0013,uTime*0.0005);
    vec3 warp=vec3(noise3(p*13.0+rockSeed),noise3(p*15.0+41.0),noise3(p*11.0+79.0));
    return (p+drift)*58.0+(warp-0.5)*5.2;
  }
  float moltenChannel(vec3 q, float filterWidth) {
    vec3 eddies=vec3(noise3(q*2.7+8.0),noise3(q*2.3+51.0),noise3(q*2.9+93.0));
    vec3 broken=q+(eddies-0.5)*0.85;
    float edge=plateBorder(broken).x;
    float width=0.018+noise3(q*3.1+18.0)*0.072;
    float seam=1.0-smoothstep(width,width+0.058+filterWidth,edge);
    float torn=0.28+0.72*smoothstep(0.19,0.73,noise3(q*6.7+71.0));
    return seam*torn;
  }
  vec4 moltenBasalt(vec3 p, vec3 viewLocal, float footprint) {
    vec3 q=moltenCoordinates(p);
    float filterWidth=min(footprint*58.0,0.12);
    float channel=moltenChannel(q,filterWidth);
    float rafts=1.0-smoothstep(0.05,0.44,channel);
    // Hot fluid breaks through a ragged cooling skin. Fine temperature grains
    // interrupt the large channels instead of drawing smooth orange outlines.
    float temperature=noise3(q*4.3+vec3(17.0,0.0,9.0));
    float resolved=clamp(1.5-footprint*58.0*32.0,0.0,1.0);
    float grains=mix(0.5,noise3(q*32.0+rockSeed),resolved);
    float scales=noise3(q*11.0+noise3(q*3.0)*2.7);
    float heat=clamp(temperature*0.55+scales*0.45+(grains-0.5)*0.48,0.0,1.0);
    vec3 hot=mix(vec3(0.40,0.005,0.0004),vec3(2.6,0.26,0.008),smoothstep(0.17,0.83,heat));
    vec3 surfaceHeat=hot*pow(channel,1.25)*(0.45+scales*0.8+grains*0.45);
    vec3 volume=vec3(0.0);
    float transmission=1.0;
    for(int i=0;i<4;i++) {
      float depth=(float(i)+1.0)*0.0024;
      vec3 below=p-viewLocal*depth;
      vec3 flow=moltenCoordinates(below);
      float vein=moltenChannel(flow,filterWidth+0.025);
      float turbulent=noise3(flow*2.5+vec3(0.0,uTime*0.012,31.0));
      volume+=vec3(0.50,0.010,0.0005)*vein*(0.3+turbulent*0.7)*transmission*0.25;
      transmission*=0.70;
    }
    vec3 emission=surfaceHeat+volume*(1.0-rafts);
    emission+=vec3(0.028,0.0012,0.0001)*sqrt(channel)*(0.3+scales*0.7);
    return vec4(emission,rafts);
  }
`;
