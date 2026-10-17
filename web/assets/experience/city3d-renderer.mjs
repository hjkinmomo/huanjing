import * as T from 'three';
import {cityEmphasis,applyCityEmphasis} from './city-scope.mjs';
import {worldDaylight} from './world-clock.mjs';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {terrainPlan} from './city-terrain.mjs';
import {CITY_MODELS,cityLayout,visibleCityActor,specialCityPlace} from './city3d-core.mjs';
import {mapZoomLevel,placeMapLabels,mapLabelActors} from './map-layout.mjs';
// All geometry/assets are local. World catalog is the only source of destinations.
export function mountCity3D(host,{map,parent=null,selected,onSelect,onStatus=()=>{},onLevelChange=()=>{},onCluster=()=>{}}){
 let disposed=false,frame=0,visible=true,down=null,loaded=0,failed=0,hover=null;
 const renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.setClearColor('#dce2df');renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
 const canvas=renderer.domElement;canvas.className='city3d-canvas';canvas.setAttribute('aria-label','立体城市：拖动旋转，滚轮缩放，点击建筑查看地点');host.append(canvas);
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(36,1,.1,350),controls=new OrbitControls(camera,canvas);
 controls.enableDamping=true;controls.dampingFactor=.09;controls.maxPolarAngle=Math.PI*.43;controls.minPolarAngle=.12;controls.minDistance=12;controls.maxDistance=260;let interacted=false;controls.addEventListener('start',()=>interacted=true);controls.enablePan=true;
 controls.zoomToCursor=true;let baseDistance=0,zoomLevel='city';
 const ambient=new T.HemisphereLight('#fff7e9','#779381',1.8);scene.add(ambient);
 const sun=new T.DirectionalLight('#fff3dc',2.5);sun.position.set(-26,48,20);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-55,right:55,top:45,bottom:-45,near:1,far:130});sun.shadow.bias=-.0007;scene.add(sun);
 const sky=document.createElement('div');sky.className='city3d-sky';sky.setAttribute('aria-label','故事世界昼夜');host.append(sky);
 const celestial=new T.Mesh(new T.SphereGeometry(1.5,20,16),new T.MeshBasicMaterial({color:'#e6dfbf'}));scene.add(celestial);
 function setTime(worldUtc,utcOffsetMinutes=480){const phase=worldDaylight(worldUtc,utcOffsetMinutes);sky.textContent=(phase.day?'☀':'☾')+' '+phase.clock+' · '+phase.label;sky.dataset.day=String(phase.day);renderer.setClearColor(new T.Color('#8b9597').lerp(new T.Color('#dce2df'),phase.brightness));ambient.intensity=.65+phase.brightness*1.2;sun.intensity=phase.day?.4+phase.brightness*2.1:.35;sun.color.set(phase.day?'#fff3dc':'#adcae9');sun.position.set(phase.day?(phase.hour-12)*6:-25,phase.day?Math.max(5,phase.elevation*48):20,20);celestial.position.set(phase.day?(phase.hour-12)*4:24,10+Math.abs(phase.elevation)*16,-28);celestial.material.color.set(phase.day?'#e6dfbf':'#e5edf4');}
 setTime(map.worldUtc,map.utcOffsetMinutes);
 const content=new T.Group();scene.add(content);const selectable=[],entries=cityLayout(map,parent),entriesById=new Map(entries.map(p=>[p.id,p])),labels=new Map(),allObjects=new Set(),moving=[];
 const track=o=>{allObjects.add(o);return o;};
 const material=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.82,...extra});
 const palette={land:material('#cbd0c2'),path:material('#e9e6dc'),road:material('#acb4ac'),wall:material('#e5dfd2'),roof:material('#9ba8a6'),glass:material('#bacbcb'),water:material('#9ebcbf',{metalness:.10,roughness:.3}),metal:material('#d7d3bb',{metalness:.6,roughness:.35}),pink:material('#b8a3a1'),green:material('#8e9f89')};
 function box(parent,w,h,d,x,y,z,mat){const o=track(new T.Mesh(new T.BoxGeometry(w,h,d),mat));o.position.set(x,y+h/2,z);o.castShadow=o.receiveShadow=true;parent.add(o);return o;}
 function cylinder(parent,r,h,x,y,z,mat){const o=track(new T.Mesh(new T.CylinderGeometry(r,r,h,12),mat));o.position.set(x,y+h/2,z);o.castShadow=o.receiveShadow=true;parent.add(o);return o;}
 function tree(parent,x,z){cylinder(parent,.12,1.3,x,0,z,palette.wall);const crown=track(new T.Mesh(new T.IcosahedronGeometry(.72,1),palette.green));crown.position.set(x,1.8,z);crown.castShadow=true;parent.add(crown);}
 const spanX=Math.max(0,...entries.map(p=>p.x))-Math.min(0,...entries.map(p=>p.x)),spanZ=Math.max(0,...entries.map(p=>p.z))-Math.min(0,...entries.map(p=>p.z));
 const terrain=terrainPlan(entries,parent),cx=terrain.center.x,cz=terrain.center.z;
 const ground=box(content,parent?Math.max(12,spanX+12):terrain.width,.65,parent?Math.max(12,spanZ+10):terrain.depth,cx,-.8,cz,palette.land);ground.receiveShadow=true;
 const roads=new T.Group();content.add(roads);
 if(!parent){
  const sea=box(content,terrain.seaSize,.18,terrain.seaSize,cx,-1.1,cz,material('#bdced0',{roughness:.35,metalness:.08}));sea.name='outer-sea';
  for(let i=0;i<7;i++){const points=[];for(let j=0;j<32;j++){const xx=cx-terrain.width/2-7+j*(terrain.width+14)/31;points.push(new T.Vector3(xx,-.89,cz+terrain.depth/2+4+i*4+Math.sin(j*.65+i)*.35));}const line=track(new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:'#e1f4ef',transparent:true,opacity:.42})));content.add(line);}
  const sand=material('#e4dfcf'),foam=material('#d6eee8',{roughness:.55});
  for(const z of [cz-terrain.depth/2,cz+terrain.depth/2])box(content,terrain.width+2,.08,2.6,cx,-.37,z,sand);
  for(const xx of [cx-terrain.width/2,cx+terrain.width/2])box(content,2.6,.08,terrain.depth+2,xx,-.37,cz,sand);
  for(const z of [cz-terrain.depth/2-2,cz+terrain.depth/2+2])box(content,terrain.width+4,.06,.5,cx,-.75,z,foam);
  for(const xx of [-26,-6,11,26]){box(roads,1.9,.07,terrain.depth-6,xx,-.07,cz,palette.road);for(let z=cz-terrain.depth/2+4;z<cz+terrain.depth/2-3;z+=4)box(roads,.08,.08,1.5,xx,-.04,z,palette.path);}
  for(const z of [-10,3,20])box(roads,terrain.width-8,.07,1.6,cx,-.04,z,palette.road);
  const curve=new T.CatmullRomCurve3(terrain.river.map(p=>new T.Vector3(p.x,.11,p.z))),samples=curve.getPoints(100),positions=[],indices=[];
  for(let i=0;i<samples.length;i++){const prev=samples[Math.max(0,i-1)],next=samples[Math.min(samples.length-1,i+1)],normal=new T.Vector3(-(next.z-prev.z),0,next.x-prev.x).normalize().multiplyScalar(1.65);for(const side of [-1,1])positions.push(samples[i].x+normal.x*side,.12,samples[i].z+normal.z*side);if(i<samples.length-1){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}}
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();const river=track(new T.Mesh(geometry,material('#aec5c5',{side:T.DoubleSide,roughness:.3,metalness:.08})));river.name='continuous-river';content.add(river);
  for(const roadZ of [-10,3,20]){const at=samples.reduce((a,b)=>Math.abs(a.z-roadZ)<Math.abs(b.z-roadZ)?a:b);box(content,5.8,.2,2.2,at.x,.25,roadZ,palette.path);for(const z of [roadZ-1.05,roadZ+1.05]){box(content,5.8,.1,.1,at.x,.8,z,palette.metal);for(const dx of [-2.7,-.9,.9,2.7])box(content,.1,.6,.1,at.x+dx,.25,z,palette.metal);}}
  const occupied=entries.map(p=>({x:p.x,z:p.z}));
  for(let i=0;i<44;i++){const xx=cx-terrain.width/2+4+((i*19.71)%(terrain.width-8)),z=cz-terrain.depth/2+4+((i*11.13)%(terrain.depth-8));if(occupied.some(p=>Math.abs(p.x-xx)<4&&Math.abs(p.z-z)<4)||samples.some(p=>Math.abs(p.x-xx)<3&&Math.abs(p.z-z)<3)||[-26,-6,11,26].some(p=>Math.abs(p-xx)<1.5)||[-10,3,20].some(p=>Math.abs(p-z)<1.5))continue;tree(content,xx,z);}
 }
 const ferris=(group)=>{
  box(group,5.4,.15,4.2,0,0,0,palette.path);for(const z of [-1.2,1.2]){const beam=box(group,.24,4.7,.25,0,0,z,palette.metal);beam.rotation.z=.13;}
  const wheel=new T.Group();wheel.position.set(0,4,0);group.add(wheel);
  const rim=track(new T.Mesh(new T.TorusGeometry(2.3,.095,7,48),palette.metal));wheel.add(rim);
  for(let i=0;i<10;i++){const a=i/10*Math.PI*2,spoke=box(wheel,.055,2.3,.06,0,0,0,palette.metal);spoke.position.set(Math.cos(a)*1.15,Math.sin(a)*1.15,0);spoke.rotation.z=a-Math.PI/2;const gondola=new T.Group();gondola.position.set(Math.cos(a)*2.3,Math.sin(a)*2.3,0);box(gondola,.48,.45,.48,0,-.35,0,i%2?palette.glass:palette.pink);wheel.add(gondola);moving.push({wheel,gondola});}
  for(const x of [-2.8,2.8]){box(group,.1,.65,4.5,x,0,0,palette.metal);for(const z of [-1.6,0,1.6])cylinder(group,.12,.9,x,0,z,palette.metal);}tree(group,-2,1.6);
 };
 function custom(group,p){
  if(p.kind==='amusement'){ferris(group);return;}
  if(p.kind==='room'){box(group,5.4,.16,5,0,0,0,palette.path);box(group,5.4,1.4,.14,0,.16,-2.45,palette.wall);box(group,.14,1.4,5,-2.65,.16,0,palette.wall);box(group,1.6,.7,1,-1,.16,-1,palette.roof);box(group,1.2,.5,.5,1,.16,1,palette.wall);return;}
  if(['beach','river'].includes(p.kind)){box(group,5.8,.1,4.4,0,0,0,palette.path);box(group,5.8,.12,2.3,0,.1,1.1,palette.water);tree(group,-1.7,-1.2);return;}
  if(['park','square'].includes(p.kind)){box(group,5,.1,4.4,0,0,0,palette.path);for(const [x,z] of [[-1.8,-1.4],[1.8,-1.4],[-1.8,1.4]])tree(group,x,z);cylinder(group,.7,.22,0,.1,0,palette.metal);cylinder(group,.5,.24,0,.31,0,palette.water);box(group,1.6,.25,.42,1,.5,1.3,palette.wall);return;}
  if(p.kind==='station'){box(group,5,.3,3,0,0,0,palette.path);box(group,5,.14,3,0,2.2,0,palette.roof);for(const x of [-2,2])for(const z of [-1,1])cylinder(group,.12,2.2,x,0,z,palette.metal);box(group,3.4,.85,1,0,.3,0,palette.glass);return;}
  box(group,3,2.4,2.6,0,0,0,palette.wall);box(group,3.3,.25,2.9,0,2.4,0,palette.roof);box(group,1.6,.7,.08,0,.9,1.35,palette.glass);
 }
 const loader=new GLTFLoader(),models=new Map(),buildings=new Map();let scopeDistrict='';
 async function model(name){if(!models.has(name))models.set(name,loader.loadAsync('/assets/experience/media/city3d-v1/'+name+'.glb').then(g=>{g.scene.traverse(o=>{if(o.isMesh){allObjects.add(o);o.castShadow=o.receiveShadow=true;for(const m of [].concat(o.material||[])){if(m.color){const hsl={};m.color.getHSL(hsl);m.color.setHSL(hsl.h,hsl.s*.22,Math.min(.84,Math.max(.48,hsl.l*.5+.35)));}}}});if(disposed)disposeObjects();return g.scene;}));return models.get(name);}
 function label(p){const b=document.createElement('button');b.type='button';b.className='city3d-label';b.textContent=p.name;b.dataset.locationId=p.id;b.dataset.special=String(specialCityPlace(p.place));b.setAttribute('aria-label','查看'+p.name);b.onclick=()=>b._members?.length>1?onCluster(b._members):onSelect(p.id);host.append(b);labels.set(p.id,b);}
 for(const p of entries){const group=new T.Group();group.position.set(p.x,0,p.z);content.add(group);buildings.set(p.id,group);box(group,6,.08,5.5,0,0,0,palette.path);const root=track(new T.Mesh(new T.BoxGeometry(6,6,5.5),new T.MeshBasicMaterial({visible:false})));root.position.y=3;root.userData.locationId=p.id;group.add(root);selectable.push(root);label(p);custom(group,p);const initialChildren=group.children.slice(2);
  if(specialCityPlace(p.place)){const crystal=track(new T.Mesh(new T.OctahedronGeometry(.35),material('#b295bd',{metalness:.2})));crystal.position.set(2.45,.7,2.2);group.add(crystal);}const name=CITY_MODELS[p.kind];if(name)model(name).then(source=>{if(disposed)return;for(const o of initialChildren)group.remove(o);const clone=source.clone(true),bounds=new T.Box3().setFromObject(clone),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());const scale=Math.min(4.6/Math.max(size.x,.1),4/Math.max(size.z,.1),(p.kind==='apartment'||p.kind==='office'?7:4.5)/Math.max(size.y,.1));clone.scale.setScalar(scale);clone.position.set(-center.x*scale,-bounds.min.y*scale+.1,-center.z*scale);group.add(clone);applyCityEmphasis(group,p.place,scopeDistrict);loaded++;onStatus({loaded,failed,total:entries.length});}).catch(()=>{if(!disposed){failed++;onStatus({loaded,failed,total:entries.length});}});
 }
 const markers=new T.Group();scene.add(markers);let actorIds=new Set(),actorCounts=new Map(),actorPins=new Map();
 function updateMarkers(selection,actors={}){selected=selection;for(const o of markers.children){allObjects.delete(o);o.geometry.dispose();o.material.dispose();}markers.clear();for(const pin of actorPins.values())pin.remove();actorPins.clear();actorIds=new Set();actorCounts=new Map();
  const members=[{kind:'user',id:visibleCityActor(map.locations,actors.user,parent),name:'你'},...(actors.characters?.length?actors.characters:[{locationId:actors.character,name:'角色'}]).map(a=>({kind:'character',id:visibleCityActor(map.locations,a.locationId,parent),name:a.name||a.roleId}))];
  for(const actor of members){if(!actor.id)continue;actorIds.add(actor.id);const list=actorCounts.get(actor.id)||[];list.push(actor);actorCounts.set(actor.id,list);}
  for(const [id,members] of actorCounts){const p=entriesById.get(id);if(!p)continue;const pin=document.createElement('span');pin.className='city3d-actor-stack';for(const kind of ['user','character'])if(members.some(a=>a.kind===kind)){const dot=document.createElement('i');dot.dataset.actor=kind;pin.append(dot);}if(members.length>2){const count=document.createElement('b');count.textContent=members.length;pin.append(count);}host.append(pin);actorPins.set(id,pin);for(const [i,kind] of ['user','character'].filter(kind=>members.some(a=>a.kind===kind)).entries()){const mat=new T.MeshBasicMaterial({color:kind==='user'?'#418bda':'#32926b',depthTest:false,transparent:true,opacity:.96}),sphere=track(new T.Mesh(new T.SphereGeometry(.46,12,10),mat));sphere.position.set(p.x+i*.9,8.8,p.z);sphere.userData.locationId=id;sphere.renderOrder=30;markers.add(sphere);}}
  for(const [id,b] of labels){const people=actorCounts.get(id);b.dataset.selected=String(id===selected);b.dataset.current=String(!!people);b.textContent=entriesById.get(id).name+(people?.length>1?' · '+people.length+' 人':'');b.title=people?people.map(a=>a.name).join('、'):entriesById.get(id).name;}
 }
 updateMarkers(selected,{...map.actorLocations,characters:map.actors||[]});
 const points=entries.map(p=>new T.Vector3(p.x,0,p.z)),boxBounds=new T.Box3().setFromPoints(points.length?points:[new T.Vector3()]),center=boxBounds.getCenter(new T.Vector3());controls.target.set(center.x,0,center.z);const distance=parent?Math.max(15,Math.max(spanX,spanZ)*1.1):Math.max(48,spanX*.8);camera.position.set(center.x+distance*.66,distance*.8,center.z+distance);controls.update();const initial={position:camera.position.clone(),target:controls.target.clone()};
 function fitView(){
  camera.position.copy(initial.position);controls.target.copy(initial.target);camera.lookAt(controls.target);camera.updateMatrixWorld();
  const hw=ground.geometry.parameters.width/2+3,hd=ground.geometry.parameters.depth/2+3;
  for(let i=0;i<5;i++){let extent=0;for(const dx of [-hw,hw])for(const dz of [-hd,hd])for(const h of [0,6]){const p=new T.Vector3(ground.position.x+dx,h,ground.position.z+dz).project(camera);extent=Math.max(extent,Math.abs(p.x),Math.abs(p.y));}if(extent<.92)break;camera.position.sub(controls.target).multiplyScalar(Math.min(1.6,extent/.88)).add(controls.target);camera.lookAt(controls.target);camera.updateMatrixWorld();}
  controls.update();
  if(!interacted){baseDistance=camera.position.distanceTo(controls.target);zoomLevel='city';}
 }
 function cameraLevel(){if(!interacted||!baseDistance)return;const next=mapZoomLevel(camera.position.distanceTo(controls.target)/baseDistance);if(next===zoomLevel)return;zoomLevel=next;onLevelChange({level:next,locationId:hover||'',district:''});}
 controls.addEventListener('change',cameraLevel);

 const ray=new T.Raycaster(),mouse=new T.Vector2();function pick(e){const rect=canvas.getBoundingClientRect();mouse.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(mouse,camera);return ray.intersectObjects(selectable.filter(o=>buildings.get(o.userData.locationId)?.visible))[0]?.object.userData.locationId;}
 const pointerdown=e=>{down={x:e.clientX,y:e.clientY};},pointerup=e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<5){const id=pick(e);if(id)onSelect(id);}down=null;},pointermove=e=>{hover=pick(e);canvas.style.cursor=hover?'pointer':'grab';};
 canvas.addEventListener('pointerdown',pointerdown);canvas.addEventListener('pointerup',pointerup);canvas.addEventListener('pointermove',pointermove);
 const lost=e=>{e.preventDefault();onStatus({error:'立体地图显卡上下文中断，地点列表仍可使用。'});};canvas.addEventListener('webglcontextlost',lost);
 const resize=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(w&&h){renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();if(!interacted)fitView();}});resize.observe(host);
 const observer=new IntersectionObserver(entries=>visible=entries[0]?.isIntersecting!==false);observer.observe(host);
 const projected=new T.Vector3();function render(){if(disposed)return;frame=requestAnimationFrame(render);if(!visible||document.hidden)return;controls.update();if(document.documentElement.dataset.reduced!=='true'){const wheels=new Set();for(const part of moving){if(!wheels.has(part.wheel)){part.wheel.rotation.z+=.0015;wheels.add(part.wheel);}part.gondola.rotation.z=-part.wheel.rotation.z;}}
  for(const o of markers.children)o.visible=buildings.get(o.userData.locationId)?.visible!==false;
  renderer.render(scene,camera);for(const b of labels.values())b.hidden=true;for(const pin of actorPins.values())pin.hidden=true;
  const candidates=[];
  for(const p of entries){if((cityEmphasis(p.place,scopeDistrict).dimmed&&!actorIds.has(p.id))||!(p.id===hover||actorIds.has(p.id)))continue;projected.set(p.x,actorIds.has(p.id)?10:1,p.z).project(camera);if(projected.z>1||Math.abs(projected.x)>1.02||Math.abs(projected.y)>1.02)continue;candidates.push({id:p.id,x:(projected.x+1)*host.clientWidth/2,y:(-projected.y+1)*host.clientHeight/2,width:Math.max(60,p.name.length*11+28)});}
  for(const layout of placeMapLabels(candidates,host.clientWidth,host.clientHeight)){const b=labels.get(layout.id);b.hidden=false;b.dataset.subtle='false';b._members=layout.members;b.textContent=entriesById.get(layout.id).name+(layout.members.length>1?' +'+(layout.members.length-1):actorCounts.get(layout.id)?.length>1?' · '+actorCounts.get(layout.id).length+' 人':'');b.style.maxWidth=layout.width+'px';b.style.transform=`translate(${layout.x}px,${layout.y}px) translate(-50%,-50%)`;const clusterActors=mapLabelActors(layout,actorCounts),pin=layout.members.map(id=>actorPins.get(id)).find(Boolean);if(pin){const signature=clusterActors.map(a=>a.kind+':'+a.name).join('|');if(pin._signature!==signature){pin._signature=signature;pin.replaceChildren();for(const kind of ['user','character'])if(clusterActors.some(a=>a.kind===kind)){const dot=document.createElement('i');dot.dataset.actor=kind;pin.append(dot);}if(clusterActors.length>2){const count=document.createElement('b');count.textContent=clusterActors.length;pin.append(count);}pin.title=clusterActors.map(a=>a.name).join('、');}pin.hidden=false;pin.style.transform=`translate(${layout.x}px,${layout.y-18}px) translate(-50%,-50%)`;}if(layout.members.length>1)b.title=layout.members.map(id=>entriesById.get(id).name).join('、');}

 }
 render();onStatus({loaded:0,failed:0,total:entries.length});
 function disposeObjects(){const geometries=new Set(),materials=new Set(),textures=new Set();content.traverse(o=>{if(o.isMesh)allObjects.add(o);});for(const o of allObjects){if(o.geometry)geometries.add(o.geometry);for(const m of [].concat(o.material||[])){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}}for(const m of Object.values(palette))materials.add(m);for(const v of geometries)v.dispose();for(const v of materials)v.dispose();for(const v of textures)v.dispose();}
 return {setTime,scope(district=''){scopeDistrict=district;for(const p of entries)applyCityEmphasis(buildings.get(p.id),p.place,scopeDistrict);},update:(id,actors)=>updateMarkers(id,actors),reset(){interacted=false;fitView();onLevelChange({level:'city',locationId:selected,district:''});},zoom(direction){interacted=true;camera.position.sub(controls.target).multiplyScalar(direction>0?.85:1.18).add(controls.target);controls.update();},destroy(){disposed=true;cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();controls.removeEventListener('change',cameraLevel);controls.dispose();canvas.removeEventListener('pointerdown',pointerdown);canvas.removeEventListener('pointerup',pointerup);canvas.removeEventListener('pointermove',pointermove);canvas.removeEventListener('webglcontextlost',lost);disposeObjects();celestial.geometry.dispose();celestial.material.dispose();sky.remove();renderer.dispose();renderer.forceContextLoss();canvas.remove();for(const b of labels.values())b.remove();for(const pin of actorPins.values())pin.remove();}};
}
