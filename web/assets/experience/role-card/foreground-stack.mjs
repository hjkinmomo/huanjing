import {ornamentPoint} from './ornament-layout.mjs';
import {registeredLayer,placedPoint} from './card-placement.mjs';
import {NAME_DEPTH} from './card-depth.mjs';
import {PARALLAX_LIMITS,depthLimitGLSL,limitedPoint} from './parallax-limits.mjs';
export function createForegroundStack(THREE,root,loader,shared){
 let items=[],disposed=false,nameVisible=true;const group=new THREE.Group(),alphaPixels=new WeakMap();
 group.name='card-foreground';root.add(group);
 const vertex=`varying vec2 vUv;varying vec3 vCard;uniform vec3 uView;uniform vec2 uPlaneScale;uniform float uTravelLimit;${depthLimitGLSL}
 void main(){vUv=uv;vCard=vec3(position.xy*uPlaneScale,position.z);vCard.xy+=depthCompensation(position.z,uView,uTravelLimit);vec3 p=vec3(vCard.xy/uPlaneScale,vCard.z);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`;
 const fragment=`precision highp float;varying vec2 vUv;varying vec3 vCard;uniform sampler2D tArt;uniform vec3 uView;uniform vec4 uClip;uniform float uFinish,uFoil,uShadow,uOpacity,uBounded;${depthLimitGLSL}
 void main(){vec2 top=vec2(vUv.x,1.-vUv.y);if(top.x<uClip.x||top.y<uClip.y||top.x>uClip.z||top.y>uClip.w)discard;vec4 art=texture2D(tArt,vUv);art.a*=uOpacity*frontVisibility(uView);if(uBounded>.5){vec2 footprint=vCard.xy-vCard.z*uView.xy/max(abs(uView.z),.4);float edge=max(abs(footprint.x)/3.,abs(footprint.y)/4.5);art.a*=1.-smoothstep(.94,1.,edge);float cropEdge=min(min(top.x-uClip.x,uClip.z-top.x),min(top.y-uClip.y,uClip.w-top.y));art.a*=smoothstep(0.,.004,cropEdge);}if(art.a<.02)discard;if(uShadow>.5){float tail=1.-vUv.y;gl_FragColor=vec4(.09,.035,.055,art.a*(.13-.07*tail));return;}float original=1.-step(.05,abs(uFinish-2.));float highlight=pow(.5+.5*sin((vUv.x*.63+vUv.y*.42+uView.x*.75-uView.y*.5)*6.28318),22.);vec3 foil=abs(uFinish-3.)<.1?vec3(1.,.83,.48):uFinish>.5?vec3(.88,.94,1.):vec3(1.,.93,.82);if(uFinish>3.5)foil=.62+.38*cos(6.28318*(vUv.x+vUv.y*.5+uView.x+vec3(0.,.33,.67)));float bright=smoothstep(.38,.8,dot(art.rgb,vec3(.2126,.7152,.0722)));art.rgb+=foil*highlight*bright*.18*uFoil*(1.-original);gl_FragColor=vec4(pow(clamp(art.rgb,0.,1.),vec3(2.2)),art.a);\n#include <colorspace_fragment>}`;
 function material(texture,shadow=false,opacity=1,clip=[0,0,1,1],bounded=true){return new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms:{tArt:{value:texture},uView:shared.uView,uPlaneScale:{value:new THREE.Vector2(1,1)},uFinish:shared.uFinish,uFoil:shared.uFoil,uShadow:{value:shadow?1:0},uOpacity:{value:opacity},uBounded:{value:bounded?1:0},uTravelLimit:{value:bounded?PARALLAX_LIMITS.ornament:PARALLAX_LIMITS.name},uClip:{value:new THREE.Vector4(...clip)}},transparent:true,depthTest:bounded,depthWrite:false,side:THREE.FrontSide});}
 function release(values){for(const item of values){for(const mesh of [item.mesh,item.shadow]){if(mesh){mesh.geometry.dispose();mesh.material.dispose();}}item.texture.dispose();}}
 function geometry(layer,shadow=false){
  const g=new THREE.PlaneGeometry(1,1,12,36),p=g.attributes.position,uv=g.attributes.uv;
  for(let i=0;i<p.count;i++){const [x,y,z]=ornamentPoint(layer,uv.getX(i),1-uv.getY(i));const lift=z-(layer.anchorDepth??layer.depth);p.setXYZ(i,x+(shadow?lift*.03:0),y-(shadow?lift*.045:0),shadow?.042:z);}
  g.computeVertexNormals();g.computeBoundingSphere();return g;
 }
 function nameTexture(name,accent,light){
  const c=document.createElement('canvas');c.width=1536;c.height=320;const ctx=c.getContext('2d');
  ctx.textAlign='center';ctx.textBaseline='middle';let text=String(name||'角色').slice(0,60),size=216;
  ctx.font=`${size}px "KaiTi","Microsoft YaHei",serif`;while(ctx.measureText(text).width>1250&&size>128){size-=2;ctx.font=`${size}px "KaiTi","Microsoft YaHei",serif`;}
  if(ctx.measureText(text).width>1250){const letters=Array.from(text);while(letters.length&&ctx.measureText(letters.join('')+'…').width>1250)letters.pop();text=letters.join('')+'…';}
  const plateWidth=Math.min(1400,Math.max(720,ctx.measureText(text).width+210));
  ctx.fillStyle=light?'rgba(255,247,233,.91)':'rgba(30,31,40,.86)';ctx.beginPath();ctx.roundRect(768-plateWidth/2,22,plateWidth,224,46);ctx.fill();
  ctx.strokeStyle=accent;ctx.lineWidth=4;ctx.stroke();
  ctx.lineJoin='round';ctx.lineWidth=5;ctx.strokeStyle=light?'#fff3df':'#281d2d';ctx.shadowBlur=6;ctx.shadowColor=light?'#fff3df':'#191422';ctx.shadowOffsetY=2;
  ctx.strokeText(text,768,140);ctx.fillStyle=light?'#683d48':'#fcf2df';ctx.fillText(text,768,140);
  ctx.shadowBlur=0;ctx.shadowOffsetY=0;ctx.strokeStyle=accent;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(438,258);ctx.lineTo(1098,258);ctx.stroke();
  for(const x of [394,1142]){ctx.save();ctx.translate(x,258);ctx.rotate(Math.PI/4);ctx.fillStyle=accent;ctx.fillRect(-6,-6,12,12);ctx.restore();}
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.NoColorSpace;return texture;
 }
 async function prepare(layers,name,accent,light=false){
  const values=[];
  try{
   for(const layer of layers){
    const texture=await loader.loadAsync(layer.asset);texture.colorSpace=THREE.NoColorSpace;
    const mesh=new THREE.Mesh(geometry(layer),material(texture,false,1,layer.clipUV));mesh.name=layer.id;mesh.renderOrder=12;
    const shadow=layer.kind==='registered-plane'?null:new THREE.Mesh(geometry(layer,true),material(texture,true,1,layer.clipUV));if(shadow)shadow.renderOrder=9;
    values.push({id:layer.id,label:layer.label,depth:layer.depth,layer,texture,mesh,shadow});
   }
   const texture=nameTexture(name,accent,light),g=new THREE.PlaneGeometry(3.35,.70,24,1),p=g.attributes.position;
   for(let i=0;i<p.count;i++)p.setZ(i,NAME_DEPTH-.35+.35*Math.cos(p.getX(i)/3.35*Math.PI));
   const mesh=new THREE.Mesh(g,material(texture,false,1,[0,0,1,1],false));mesh.position.set(0,-3.62,0);mesh.name='floating-name';mesh.renderOrder=30;mesh.visible=nameVisible;
   values.push({id:'floating-name',label:'悬浮名字',depth:NAME_DEPTH,texture,mesh});
   return {discard(){release(values);},commit(){if(disposed){release(values);return;}release(items);group.clear();items=values;for(const v of values){if(v.shadow)group.add(v.shadow);group.add(v.mesh);}}};
  }catch(error){release(values);throw error;}
 }
 function updatePlacement(){for(const v of items)if(registeredLayer(v.layer))for(const mesh of [v.mesh,v.shadow])if(mesh){const sx=shared.uFit.value.x/shared.uScale.value,sy=shared.uFit.value.y/shared.uScale.value;mesh.scale.set(sx,sy,1);mesh.material.uniforms.uPlaneScale.value.set(sx,sy);}}
 function sample(item,u,v){const point=ornamentPoint(item.layer,u,v);return registeredLayer(item.layer)?placedPoint(point,[shared.uFit.value.x,shared.uFit.value.y],shared.uScale.value):point;}
 function project(camera,local,limit=PARALLAX_LIMITS.ornament){const p=new THREE.Vector3(...limitedPoint(local.toArray(),shared.uView.value.toArray(),limit)).applyMatrix4(root.matrixWorld).project(camera),print=local.clone().setZ(0).applyMatrix4(root.matrixWorld).project(camera);return {screen:[p.x,p.y],relativeToPrint:[p.x-print.x,p.y-print.y]};}
 function occlusion(camera,points){
  const ray=new THREE.Raycaster();return points.map(([u,v])=>{
   const print=new THREE.Vector3((u-.5)*6,(.5-v)*9,0).applyMatrix4(root.matrixWorld).project(camera);ray.setFromCamera(new THREE.Vector2(print.x,print.y),camera);
   for(const item of items){if(!item.layer)continue;const hit=ray.intersectObject(item.mesh)[0];if(!hit)continue;const clip=item.layer.clipUV||[0,0,1,1];if(hit.uv.x<clip[0]||1-hit.uv.y<clip[1]||hit.uv.x>clip[2]||1-hit.uv.y>clip[3])continue;
    let pixels=alphaPixels.get(item.texture);if(!pixels){const image=item.texture.image,c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);pixels={width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height).data};alphaPixels.set(item.texture,pixels);}
    const x=Math.min(pixels.width-1,Math.max(0,Math.floor(hit.uv.x*pixels.width))),y=Math.min(pixels.height-1,Math.max(0,Math.floor((1-hit.uv.y)*pixels.height)));
    if(pixels.data[(y*pixels.width+x)*4+3]>128)return true;
   }return false;
  });
 }
 return {prepare,occlusion,updatePlacement,setNameVisible(value){nameVisible=value;for(const item of items)if(item.id==='floating-name')item.mesh.visible=value;},state(camera){return items.map(item=>{
  const center=item.layer?sample(item,.5,.65):[0,-3.62,NAME_DEPTH];
  const result={id:item.id,label:item.label,depth:item.depth,travelLimit:item.layer?PARALLAX_LIMITS.ornament:PARALLAX_LIMITS.name,...project(camera,new THREE.Vector3(...center),item.layer?PARALLAX_LIMITS.ornament:PARALLAX_LIMITS.name)};
  if(item.layer&&!['plane','registered-plane'].includes(item.layer.kind)){result.anchor={depth:item.layer.anchorDepth,...project(camera,new THREE.Vector3(...sample(item,...item.layer.anchorUV)))};result.freeEnd={depth:item.layer.depth,...project(camera,new THREE.Vector3(...sample(item,...(item.layer.tipUV||[item.layer.anchorUV[0],1]))))};}
  return result;
 });},dispose(){disposed=true;release(items);items=[];group.clear();root.remove(group);}};
}
