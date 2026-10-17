import {CARD_DISPLAYS,DISPLAY_DEPTH,normalizeCardDisplay,cardDisplayAsset} from '../card-display-config.mjs';
import {depthLimitGLSL,limitedPoint,depthCompensation,frontVisibility} from './parallax-limits.mjs';
import {assembleDisplay} from './display-assembly.mjs';

export function createDisplayStack(THREE,root,shared,onChange){
 const group=new THREE.Group();group.name='card-display';root.add(group);
 let generation=0,current='none',currentName='',items=[],disposed=false,requested='',pendingLoad=null;
 const vertex=`varying vec2 vUv;uniform vec3 uView;uniform float uLayerDepth,uTravelLimit;${depthLimitGLSL}
 void main(){vUv=uv;vec3 p=position;p.xy+=depthCompensation(uLayerDepth,uView,uTravelLimit);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`;
 const fragment=`precision highp float;varying vec2 vUv;uniform sampler2D tArt;uniform vec3 uView;uniform float uFinish;${depthLimitGLSL}
 void main(){vec4 art=texture2D(tArt,vUv);art.a*=frontVisibility(uView);if(art.a<.015)discard;float foil=step(.05,abs(uFinish-2.));float band=pow(.5+.5*sin((vUv.x*.7+vUv.y*.3+uView.x*.9-uView.y*.5)*6.28318),12.);float bright=smoothstep(.3,.8,dot(art.rgb,vec3(.2126,.7152,.0722)));art.rgb+=vec3(.92,.95,1.)*band*bright*.05*foil;gl_FragColor=vec4(pow(clamp(art.rgb,0.,1.),vec3(2.2)),art.a);\n#include <colorspace_fragment>}`;
 function release(){for(const item of items){item.mesh.geometry.dispose();item.mesh.material.dispose();item.texture.dispose();}items=[];group.clear();}
 function reset(){release();current='none';currentName='';onChange?.('none');}
 function configure(value,name){
  const id=normalizeCardDisplay(value),textName=String(name||'角色'),key=JSON.stringify([id,textName]);
  if(requested===key&&pendingLoad)return pendingLoad;
  if(current===id&&(id==='none'||currentName===textName))return Promise.resolve(true);
  requested=key;const token=++generation;if(id==='none'){reset();pendingLoad=null;return Promise.resolve(true);}
  const loading=(async()=>{try{
   const image=new Image();image.decoding='async';image.src=cardDisplayAsset(id);await image.decode();if(token!==generation||disposed)return false;
   const spec=CARD_DISPLAYS.find(p=>p.id===id),pieces=assembleDisplay(image,spec,textName);release();
   for(const part of pieces){
    const texture=new THREE.CanvasTexture(part.canvas);texture.colorSpace=THREE.NoColorSpace;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;
    const material=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms:{tArt:{value:texture},uView:shared.uView,uFinish:shared.uFinish,uLayerDepth:{value:part.depth},uTravelLimit:{value:part.limit}},transparent:true,depthTest:false,depthWrite:false,side:THREE.FrontSide});
    const [left,top,right,bottom]=part.rect,geometry=new THREE.PlaneGeometry((right-left)*6,(bottom-top)*9),mesh=new THREE.Mesh(geometry,material);
    mesh.name=`display-front-${part.id}`;mesh.position.set(((left+right)/2-.5)*6,(.5-(top+bottom)/2)*9,part.depth);mesh.renderOrder=part.kind==='rail'?50:part.kind==='nameplate'?54:52;group.add(mesh);items.push({mesh,part,texture});
   }
   current=id;currentName=textName;onChange?.(id);return true;
  }catch{if(token===generation&&!disposed){requested='';reset();}return false;}})();
  pendingLoad=loading;loading.finally(()=>{if(pendingLoad===loading)pendingLoad=null;});return loading;
 }
 return {configure,state(camera){return {id:current,name:currentName,depth:DISPLAY_DEPTH,meshCount:items.length,parts:items.map(({part})=>{
  const [left,top,right,bottom]=part.rect,point=[((left+right)/2-.5)*6,(.5-(top+bottom)/2)*9,part.depth],effective=limitedPoint(point,shared.uView.value.toArray(),part.limit),p=new THREE.Vector3(...effective).applyMatrix4(root.matrixWorld).project(camera),print=new THREE.Vector3(point[0],point[1],0).applyMatrix4(root.matrixWorld).project(camera);
  return {id:part.id,kind:part.kind,rect:part.rect,sourceBox:part.sourceBox,depth:part.depth,travelLimit:part.limit,screen:[p.x,p.y],relativeToPrint:[p.x-print.x,p.y-print.y]};
 }),parent:group.parent?.name||'card-root'};},dispose(){disposed=true;generation++;release();root.remove(group);}};
}

export function createCSSDisplayStack(card,onChange){
 let id='none',generation=0,requested='',pendingLoad=null,parts=[];
 function clear(){card.querySelectorAll('.card-display-layer').forEach(n=>n.remove());parts=[];id='none';onChange?.('none');}
 function configure(value,name){
  const next=normalizeCardDisplay(value),key=JSON.stringify([next,name]);if(requested===key&&pendingLoad)return pendingLoad;if(requested===key&&id===next)return Promise.resolve(true);requested=key;const token=++generation;if(next==='none'){clear();return Promise.resolve(true);}
  const loading=(async()=>{try{const image=new Image();image.src=cardDisplayAsset(next);await image.decode();if(token!==generation)return false;const spec=CARD_DISPLAYS.find(p=>p.id===next),pieces=assembleDisplay(image,spec,name);clear();parts=pieces;
   for(const part of parts){const layer=document.createElement('div');layer.className='card-display-layer';layer.dataset.part=part.id;layer.dataset.kind=part.kind;layer.displayPart=part;
    const [l,t,r,b]=part.rect;layer.style.inset='auto';layer.style.left=l*100+'%';layer.style.top=t*100+'%';layer.style.width=(r-l)*100+'%';layer.style.height=(b-t)*100+'%';layer.style.zIndex=part.kind==='rail'?'3':part.kind==='nameplate'?'5':'4';
    const canvas=part.canvas.cloneNode();canvas.getContext('2d').drawImage(part.canvas,0,0);layer.append(canvas);card.append(layer);
   }
   id=next;onChange?.(id);return true;
  }catch{if(token===generation){requested='';clear();}return false;}})();pendingLoad=loading;loading.finally(()=>{if(pendingLoad===loading)pendingLoad=null;});return loading;
 }
 function update(view,width){for(const layer of card.querySelectorAll('.card-display-layer')){const p=layer.displayPart,[cx,cy]=depthCompensation(p.depth,view,p.limit);layer.style.opacity=frontVisibility(view);layer.style.transform=`translate3d(${cx*width/6}px,${cy*width/6}px,${p.depth*width/6}px)`;}}
 return {configure,update,state(){return {id,depth:DISPLAY_DEPTH,meshCount:parts.length,parts:parts.map(({id,kind,rect,sourceBox,depth,limit})=>({id,kind,rect,sourceBox,depth,travelLimit:limit}))};},dispose(){generation++;clear();}};
}
