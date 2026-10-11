import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { surfaceProfile, terrainHeightField, terrainHeightKm } from '../LegacyWeb/shared/surface.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, 'LegacyWeb', p), 'utf8'));
const world = read('shared/world.json');
const extra = ['moons', 'centauri', 'betelgeuse', 'echo-rift', 'barnard'].flatMap(p => read(`shared/${p}.json`));
const names = {sun:'太阳',mercury:'水星',venus:'金星',earth:'地球',mars:'火星',jupiter:'木星',saturn:'土星',uranus:'天王星',neptune:'海王星',ceres:'谷神星','earth-station':'远航星舰',gargantua:'暗渊黑洞'};
const colors = {sun:'#ffbd68',earth:'#6ba9df',mars:'#c37a51',jupiter:'#d2b08c',saturn:'#c7b58b',uranus:'#83c9cf',neptune:'#4879cd'};
const textures = {sun:'sun-real',earth:'earth-day',mercury:'mercury-real',venus:'venus-real',mars:'mars-real',jupiter:'jupiter-real',saturn:'saturn-real',uranus:'uranus-real',neptune:'neptune-real',moon:'moon-real',ceres:'concept-ceres','alpha-centauri-a':'star-g','alpha-centauri-b':'star-k','proxima-centauri':'star-m',betelgeuse:'betelgeuse-4k','proxima-b':'concept-makemake','proxima-c':'concept-venuslike','proxima-d':'concept-ceres',nereid:'concept-haumea'};
const out = path.join(root, 'Assets/StreamingAssets/Voyager');
fs.mkdirSync(path.join(out, 'Terrain'), {recursive:true});
const vector = a => ({x:a[0],y:a[1],z:a[2]});
const fields = new Map();
const fixtures = [];
const bodies = world.bodies.map(body => {
  const info = extra.find(b => b.id === body.id) ?? {};
  const profile = surfaceProfile(body.id);
  const field = profile.solid ? terrainHeightField(body.id) : null;
  let terrain = null;
  if (field) {
    const name = field.sourceId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.bytes';
    if (!fields.has(name)) { fs.writeFileSync(path.join(out, 'Terrain', name), Buffer.from(field.data)); fields.set(name, true); }
    terrain = {file:name,width:field.width,height:field.height,offsetM:field.heightOffsetKm*1000,scaleM:field.heightScaleKm*1000,tilt:field.tiltRad,yaw:field.yawRad,mapOffset:field.mapOffset,fine:field.fineEnabled};
  }
  let texture = textures[body.id] ?? (body.id.startsWith('barnard-') ? body.id+'-4k' : body.parentId ? body.id+'-real' : '');
  if (['naiad','thalassa','despina','galatea','larissa','proteus'].includes(body.id)) texture='concept-asteroid';
  for (const n of [[1,0,0],[0,1,0],[0,0,-1],[.4242640687119285,.565685424949238,.7071067811865475]])
    fixtures.push({id:body.id,normal:vector(n),heightM:terrainHeightKm(body.id,n)*1000});
  return {id:body.id,name:info.name ?? names[body.id] ?? body.id,systemId:body.systemId ?? 'solar',kind:body.kind ?? 'planet',parentId:body.parentId ?? '',positionM:vector(body.position.map(n=>n*world.unitsKm*1000)),radiusM:body.radius*world.unitsKm*1000,gravity:profile.gravity,solid:profile.solid,density:profile.density,scaleHeightM:profile.scaleKm*1000,atmosphereM:(body.atmosphereKm??0)*1000,color:info.color??colors[body.id]??profile.ground,texture,terrain};
});
fs.writeFileSync(path.join(out, 'world.json'), JSON.stringify({sourceCommit:'d6fc6a9c1e2bb1229fe74538140bf9d4c485697d',systems:world.systems.map(s=>({id:s.id,name:s.name,primaryStar:s.primaryStar})),bodies},null,2)+'\n');
fs.writeFileSync(path.join(root,'tools/PhysicsChecks/terrain-fixtures.json'), JSON.stringify(fixtures,null,2)+'\n');
console.log(`Imported ${bodies.length} bodies, ${fields.size} shared height fields and ${fixtures.length} reference samples.`);
