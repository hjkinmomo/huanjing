// RuiC layered shaders and Blender geometry, adapted for a companion UI.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {vertex,frontFragment,backFragment,edgeFragment} from './shaders.js';
import {createDetailMotion,DETAIL_IDS} from './detail-motion.mjs';
import {createForegroundStack} from './foreground-stack.mjs';
import {ornamentCSS} from './ornament-layout.mjs';
import {createCardGesture} from './card-gesture.mjs';
import {subjectFit} from './card-placement.mjs';
import {createAffinityChanges} from '../affinity-art.mjs';
import {cssParallax} from './css-parallax.mjs';
import {PARALLAX_LIMITS,cardLocalView,depthCompensation,frontVisibility} from './parallax-limits.mjs';
import {raisedProfile,artworkRoleId,NAME_DEPTH} from './card-depth.mjs';
import {supportMotion} from './card-support.mjs';
import {createCardFx,createCSSCardFx} from './card-fx.mjs';
import {fxColors,normalizeCardFx} from '../card-fx-config.mjs';
const affinityChanges=createAffinityChanges();
const stage=document.getElementById('card-stage');
const os=matchMedia('(prefers-reduced-motion: reduce)');
import {CARD_MATERIALS,DISPLAY_DEPTH,normalizeCardDisplay} from '../card-display-config.mjs';
import {createDisplayStack,createCSSDisplayStack} from './display-parts.mjs';
const finishes=CARD_MATERIALS.map(p=>p.id);
let displayStack=null;
let cardFx=null,fxOptions={style:'halo'};
let model,renderer,camera,uniforms,root,profiles,pending=null,generation=0,raf=0,last=0;
let active=true,userReduced=false,reduced=os.matches,dragging=false,flipped=false,zoom=1,finish='pearl',artFit='scene';
let faceAngle=0,currentLabel=null;const gesture=createCardGesture();
let targetX=0,targetY=0,x=targetX,y=targetY,pointer={x:0,y:0},frames=0;
let fallback=null,owned=[],disposed=false,profileId=null,foreground=null,hovering=false;
let detailMotion=createDetailMotion(),detailCoverage=[],detailLabels=[],returnAt=0,returnX=0,returnY=0,returnMs=0;
const scene=new THREE.Scene(),inverse=new THREE.Matrix4(),loader=new THREE.TextureLoader();
function tell(type,extra={}){parent.postMessage({type:`hermes-card:${type}`,...extra},location.origin);}
function safeAsset(value){
  if(typeof value!=='string')return '';
  if(/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)&&value.length<=20971520)return value;
  if(value.length>4096)return '';
  try{const url=new URL(value,location.href);if(url.origin!==location.origin)return '';return ['http:','https:','blob:'].includes(url.protocol)?url.href:'';}catch{return '';}
}
function labelTexture(data,back=false){
  const c=document.createElement('canvas');c.width=1024;c.height=1536;const ctx=c.getContext('2d');
  ctx.strokeStyle=back?'#baa784':'#f0e3c0';ctx.lineWidth=1.5;ctx.strokeRect(38,38,948,1460);
  ctx.fillStyle=back?'#3f4544':'#f7efdb';ctx.textAlign='center';
  const text=String(data.name||'角色').slice(0,60);
  let size=back?132:52;ctx.font=`${size}px "KaiTi", "Microsoft YaHei", serif`;
  while(ctx.measureText(text).width>840&&size>20){size-=2;ctx.font=`${size}px "KaiTi", "Microsoft YaHei", serif`;}
  if(!back){const lightPaper=(data.roleId==='koka'&&data.edition!=='温柔倾听')||data.edition==='玫瑰花嫁';ctx.fillStyle=lightPaper?'#4e342f':'#fff4d9';ctx.shadowColor=lightPaper?'#fff6e3':'#251723';ctx.shadowBlur=7;ctx.shadowOffsetY=1;}
  if(back){ctx.fillText(text,512,690);ctx.font='38px "Microsoft YaHei", sans-serif';ctx.fillText(String(data.relationship||'初识').slice(0,32),512,830);ctx.font='28px "Microsoft YaHei", sans-serif';ctx.fillText(data.affinityChange||'随相处变化',512,890);}ctx.font='22px "Microsoft YaHei", sans-serif';
  ctx.fillText(String(data.edition||'幻境 · 与你此刻'),512,back?1040:1475);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.NoColorSpace;return texture;
}
function detailTextures(profile,width,height){
  const textures=[],coverage=[];
  for(let group=0;group<4;group++){
    const c=document.createElement('canvas');c.width=width;c.height=height;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);
    ctx.globalCompositeOperation='lighter';ctx.filter=`blur(${Math.max(2,width*.0035)}px)`;
    for(let channel=0;channel<3;channel++){
      const layer=profile?.details?.find(p=>p.id===DETAIL_IDS[group*3+channel]);
      ctx.fillStyle=['#ff0000','#00ff00','#0000ff'][channel];
      for(const polygon of layer?.regions||[]){ctx.beginPath();polygon.forEach(([x,y],i)=>i?ctx.lineTo(x*width,y*height):ctx.moveTo(x*width,y*height));ctx.closePath();ctx.fill();}
    }
    // An additional face guard protects imported profile edits.
    if(profile?.protectedFace){const [x,y,rx,ry]=profile.protectedFace;ctx.globalCompositeOperation='source-over';ctx.filter='blur(2px)';ctx.fillStyle='#000';ctx.beginPath();ctx.ellipse(x*width,y*height,rx*width,ry*height,0,0,Math.PI*2);ctx.fill();}
    const pixels=ctx.getImageData(0,0,width,height).data;
    for(let channel=0;channel<3;channel++){let count=0;for(let i=channel;i<pixels.length;i+=4)if(pixels[i]>128)count++;coverage.push({id:DETAIL_IDS[group*3+channel],pixels:count});}
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.NoColorSpace;textures.push(texture);
  }
  return {textures,coverage};
}
function setEffects(data){fxOptions={...data};cardFx?.configure(fxOptions);if(uniforms){uniforms.uPortal.value=data.style==='portal'?1:0;const colors=fxColors(normalizeCardFx(data),data.themeColor||'#8b7361');uniforms.uPortalA.value.set(colors[0]);uniforms.uPortalB.value.set(colors[1]);}wake();}
function wake(){if(!disposed&&active&&!document.hidden&&!raf)raf=requestAnimationFrame(render);}
function render(now){
  raf=0;if(!active||document.hidden||disposed)return;
  if(!dragging&&!returnAt&&x===targetX&&y===targetY&&now-last<32){wake();return;}
  const dt=Math.min((now-last)/1000,.10)||.016;last=now;
  const ease=reduced?1:1-Math.exp(-dt*14);x+=(targetX-x)*ease;y+=(targetY-y)*ease;
  if(returnAt){const t=reduced?1:Math.min(1,(now-returnAt)/420),weight=(1-t)**3;x=targetX+(returnX-targetX)*weight;y=targetY+(returnY-targetY)*weight;if(t===1){returnMs=now-returnAt;returnAt=0;detailMotion.clear();}}
  if(Math.abs(x-targetX)<.0004)x=targetX;if(Math.abs(y-targetY)<.0004)y=targetY;
  const detailMoving=detailMotion.step(dt,x,y,reduced),details=detailMotion.snapshot();
  const fxMoving=cardFx?.step(dt,Math.sin(y),dragging,reduced)===true;
  if(renderer&&root){
    foreground?.updatePlacement();root.rotation.set(x,y,0);root.updateMatrixWorld(true);
    uniforms.uView.value.copy(camera.position).applyMatrix4(inverse.copy(root.matrixWorld).invert()).normalize();
    // Foil follows the view; a resting card never consumes a continuous loop.
    details.forEach((p,i)=>uniforms.uDetailOffsets.value[i].set(p.x,p.y));uniforms.uDetailStrength.value=reduced?0:1;uniforms.uTime.value=0;renderer.render(scene,camera);
  }else if(fallback){
    fallback.style.transform=`rotateX(${x}rad) rotateY(${y}rad)`;
    const view=cardLocalView(x,y),width=fallback.clientWidth,height=fallback.clientHeight;displayStack?.update(view,width);
    const label=fallback.querySelector('.floating-name');if(label){const [cx,cy]=depthCompensation(NAME_DEPTH,view,PARALLAX_LIMITS.name);label.style.transform=`translate(-50%,-50%) translate3d(${cx*width/6}px,${cy*width/6}px,${NAME_DEPTH*width/6}px)`;label.style.opacity=frontVisibility(view);}
    for(const img of fallback.querySelectorAll('[data-print-depth]')){
      if(img.classList.contains('foreground-art')){img.style.transform=ornamentCSS(img.cardLayer,width,height,fallback.cardFit||[1,1],artFit==='full'?1.04:1,view);img.style.opacity=frontVisibility(view);continue;}
      const [dx,dy]=cssParallax(x,y,Number(img.dataset.printDepth),fallback.clientWidth,fallback.clientHeight);
      img.style.transform=`translate(${dx}px,${dy}px) ${img.cardTransform||''}`;
    }
    fallback.style.setProperty('--foil-x',`${50+Math.sin(y)*35}%`);
  }
  frames++;if(returnAt||x!==targetX||y!==targetY||detailMoving||fxMoving)wake();
}
function reset(){cardFx?.clear();gesture.cancel();dragging=false;returnAt=0;faceAngle=0;flipped=false;zoom=1;targetX=0;targetY=0;resize();wake();tell('state',{flipped});}
function flip(direction=1){gesture.cancel();dragging=false;returnAt=0;flipped=!flipped;faceAngle+=Math.PI*direction;targetX=0;targetY=faceAngle;wake();tell('state',{flipped});}
async function setDisplay(value,name=pending?.name){const id=normalizeCardDisplay(value);await displayStack?.configure(id,name);if(fallback)fallback.style.setProperty('--display-depth',(fallback.clientWidth/6*DISPLAY_DEPTH)+'px');wake();}
function setFinish(value){finish=finishes.includes(value)?value:'pearl';if(uniforms)uniforms.uFinish.value=finishes.indexOf(finish);stage.dataset.finish=finish;wake();}
function resize(){
  if(fallback)fallback.style.setProperty('--display-depth',(fallback.clientWidth/6*DISPLAY_DEPTH)+'px');
  if(fallback)fallback.style.setProperty('--name-depth',`${fallback.clientWidth/6*NAME_DEPTH}px`);
  if(renderer&&camera){const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight),aspect=w/h;const half=Math.max(6.25,4.35/aspect)/zoom;camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();renderer.setSize(w,h,true);}
  if(fallback&&fallback.clientWidth&&fallback.clientHeight){const s=artFit==='full'?1.04:1;if(fallback.registeredSubject){const fit=fallback.cardFit,offset=fallback.artOffset||[0,0];for(const img of fallback.querySelectorAll('.card-subject,.card-effects-behind'))img.style.cssText=`inset:auto;left:${(1-fit[0]/s)*50+offset[0]*100/s}%;top:${(1-fit[1]/s)*50+offset[1]*100/s}%;width:${fit[0]/s*100}%;height:${fit[1]/s*100}%;padding:0;object-fit:fill`;}for(const image of fallback.querySelectorAll('.foreground-art'))image.cardTransform=ornamentCSS(image.cardLayer,fallback.clientWidth,fallback.clientHeight,fallback.cardFit||[1,1],s);}
  wake();
}
function white(){const t=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);t.needsUpdate=true;return t;}
function transparent(){const t=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);t.needsUpdate=true;return t;}
let inFlightKey='',shownCard=null;
async function apply(data){
 const key=JSON.stringify([data.request,data.roleId,data.name,data.portrait]);
 if(key===inFlightKey)return;
 if(shownCard?.key===key){tell('ready',{mode:shownCard.mode,request:data.request});return;}
 inFlightKey=key;
 try{const mode=await paintCard(data);if(mode&&key===inFlightKey)shownCard={key,mode};}
 finally{if(key===inFlightKey)inFlightKey='';}
}
async function paintCard(data){
  const token=++generation;
  const selected=safeAsset(data.portrait);if(!selected){tell('error',{message:'没有可用的角色图片',request:data.request});return;}
  const path=new URL(selected).pathname;
  const artRole=artworkRoleId(data.roleId);
  const matched=Object.values(profiles).find(p=>p.roleId===artRole&&(p.original===path||p.aliases?.includes(path)));
  const p=raisedProfile(matched||Object.values(profiles).find(p=>p.roleId===artRole)||profiles.koka_casual);
  const original=!!matched;
  const support=supportMotion(p,original);
  const nameLight=original&&(typeof p.nameplate?.light==='boolean'?p.nameplate.light:p.roleId==='koka'||p.id==='shira_bridal');
  const assets={subject:original?p.assets.subject:selected,background:p.assets.background,lineart:original?p.assets.lineart:null,effects:original?p.assets.effects:null};
  const labelled={...data,edition:original?p.label:'自定义立绘'};
  const name=String(data.name||'角色').slice(0,60);stage.title=name;stage.setAttribute('aria-label',`${name}的角色卡，可拖动或使用方向键调整角度，F 翻面，R 复位`);
  if(fallback){
    const images=await Promise.all(['subject','background'].map(key=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=assets[key];})));
    if(token!==generation||disposed)return;
    const front=fallback.querySelector('.card-front');front.replaceChildren();
    fallback.cardFit=subjectFit(images[0].naturalWidth/images[0].naturalHeight,original?p.presentation:null);
    fallback.registeredSubject=original&&!!p.presentation;
    fallback.artOffset=original?p.artOffset||[0,0]:[0,0];
    for(const [i,img] of images.entries()){img.alt='';img.className=i===0?'card-subject':'card-background';img.dataset.printDepth=i===0?support.fallbackDepth:p.parameters.backgroundDepth;front.append(img);}
    if(original&&p.presentation){const img=images[0],fit=fallback.cardFit,s=artFit==='full'?1.04:1;img.style.cssText=`inset:auto;left:${(1-fit[0]/s)*50}%;top:${(1-fit[1]/s)*50}%;width:${fit[0]/s*100}%;height:${fit[1]/s*100}%;padding:0;object-fit:fill`;}
    if(original&&p.registeredEffects&&assets.effects){const effect=new Image();effect.className='card-effects-behind';effect.alt='';effect.src=assets.effects;effect.dataset.printDepth=p.parameters.effectsDepth;front.append(effect);}
    const title=document.createElement('span');title.className='card-label';title.textContent=labelled.edition;title.style.fontSize='13px';front.append(title);
    fallback.querySelectorAll('.foreground-art,.floating-name').forEach(n=>n.remove());
    for(const layer of original?p.foreground||[]:[]){const image=new Image();image.className='foreground-art';image.src=layer.asset;image.alt='';image.cardLayer=layer;image.dataset.printDepth=layer.depth;if(layer.clipUV){const [x,y,r,b]=layer.clipUV;image.style.clipPath=`inset(${y*100}% ${(1-r)*100}% ${(1-b)*100}% ${x*100}%)`;}fallback.append(image);}
    const nameText=document.createElement('span');nameText.className='floating-name';nameText.textContent=name;nameText.dataset.light=String(nameLight);nameText.style.setProperty('--name-accent',p.nameplate?.accent||'#dbc19a');fallback.append(nameText);
    currentLabel={...labelled,relationship:pending?.relationship};updateMetadata(pending||labelled);
    fallback.style.setProperty('--name-depth',`${fallback.clientWidth/6*NAME_DEPTH}px`);profileId=original?p.id:null;reset();setFinish(pending?.finish||data.finish);await setDisplay(pending?.display,data.name);if(token!==generation||disposed)return;tell('ready',{mode:'css3d',request:data.request,art:{subject:safeAsset(assets.subject),background:safeAsset(assets.background),fit:fallback.cardFit,offset:fallback.artOffset,scale:artFit==='full'?1.04:1}});return 'css3d';
  }
  const fresh=[];let nextForeground=null;
  try{
    const textures=await Promise.all([loader.loadAsync(assets.subject),loader.loadAsync(assets.background),assets.lineart?loader.loadAsync(assets.lineart):Promise.resolve(white()),assets.effects?loader.loadAsync(assets.effects):Promise.resolve(transparent())].map(async promise=>{const t=await promise;fresh.push(t);return t;}));
    nextForeground=await foreground.prepare(original?p.foreground||[]:[],name,p.nameplate?.accent||'#dbc19a',nameLight);
    if(token!==generation||disposed){fresh.forEach(t=>t.dispose());nextForeground.discard();return;}
    const text=labelTexture(labelled),back=labelTexture(labelled,true),detail=detailTextures(original?p:null,textures[0].image.width,textures[0].image.height);fresh.push(text,back,...detail.textures);
    fresh.forEach(t=>{t.colorSpace=THREE.NoColorSpace;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());});
    if(original&&['unified-master','layered-rgba'].includes(p.artworkIntegrity?.mode)){
      // Keep the complete print sharp; coarse mip blends soften small faces.
      for(const texture of textures.slice(0,2)){texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;}
    }
    [uniforms.tSubject.value,uniforms.tBackground.value,uniforms.tLine.value,uniforms.tText.value,uniforms.tBack.value,uniforms.tEffects.value,uniforms.tParts.value,uniforms.tDetails.value,uniforms.tFineA.value,uniforms.tFineB.value]=[textures[0],textures[1],textures[2],text,back,textures[3],...detail.textures];
    detailMotion=createDetailMotion(original?p.details:[]);detailCoverage=detail.coverage;detailLabels=original?p.details:[];const heights=detailMotion.snapshot().map(d=>d.depth);uniforms.uDetailDepthA.value.set(...heights.slice(0,3));uniforms.uDetailDepthB.value.set(...heights.slice(3,6));uniforms.uDetailDepthC.value.set(...heights.slice(6,9));uniforms.uDetailDepthD.value.set(...heights.slice(9,12));uniforms.uFace.value.set(...(original?p.protectedFace:[0,0,0,0]));
    const aspect=textures[0].image.width/textures[0].image.height;
    uniforms.uFit.value.set(...subjectFit(aspect,original?p.presentation:null));
    const artOffset=original?p.artOffset||[0,0]:[0,0];uniforms.uSafeOffset.value.set(-artOffset[0]/uniforms.uFit.value.x,artOffset[1]/uniforms.uFit.value.y);
    const bgAspect=textures[1].image.width/textures[1].image.height;uniforms.uBgFit.value.set(Math.min(1,(2/3)/bgAspect),Math.min(1,bgAspect/(2/3)));
    uniforms.uFxRegistered.value=original&&p.registeredEffects?1:0;uniforms.uFxBehindOnly.value=original&&p.effectsBehindOnly?1:0;
    uniforms.uHasLine.value=original&&assets.lineart?1:0;uniforms.uHasFx.value=original&&assets.effects&&!p.geometryEffects?1:0;
    uniforms.uDepth.value=original?p.parameters.subjectDepth:.12;uniforms.uBgDepth.value=p.parameters.backgroundDepth;uniforms.uFxDepth.value=p.parameters.effectsDepth;uniforms.uFoil.value=original?p.parameters.foil:.16;
    uniforms.uGrounded.value=support.grounded;uniforms.uContactY.value=support.contactY;uniforms.uContactDepth.value=support.contactDepth;uniforms.uContactBand.value=support.contactBand;uniforms.uAutoInk.value=original&&p.artworkIntegrity?.mode==='layered-rgba'?1:0;
    currentLabel={...labelled,relationship:pending?.relationship,affinity:pending?.affinity};
    profileId=original?p.id:null;owned.forEach(t=>t.dispose());owned=fresh;nextForeground.commit();
    updateMetadata(pending||labelled);reset();setFinish(pending?.finish||data.finish);await setDisplay(pending?.display,data.name);if(token!==generation||disposed)return;x=targetX;y=targetY;root.rotation.set(x,y,0);root.updateMatrixWorld(true);uniforms.uView.value.copy(camera.position).applyMatrix4(inverse.copy(root.matrixWorld).invert()).normalize();renderer.render(scene,camera);tell('ready',{mode:'webgl',request:data.request,art:{subject:safeAsset(assets.subject),background:safeAsset(assets.background),fit:[uniforms.uFit.value.x,uniforms.uFit.value.y],offset:artOffset,scale:artFit==='full'?1.04:1}});return 'webgl';
  }catch(error){nextForeground?.discard();fresh.forEach(t=>t.dispose());if(token===generation)tell('error',{message:'卡片图片加载失败，请检查角色资源',request:data.request});}
}
function updateMetadata(data){
 if(!currentLabel)return;currentLabel={...currentLabel,relationship:String(data.relationship||'初识').slice(0,32),affinity:Number.isFinite(data.affinity)?data.affinity:undefined,affinityChange:affinityChanges.update(currentLabel.roleId,data.affinity)};
 if(fallback){const back=fallback.querySelector('.card-back');back.replaceChildren();for(const [key,value] of Object.entries({name:currentLabel.name,relationship:currentLabel.relationship,change:currentLabel.affinityChange,edition:currentLabel.edition})){if(!value)continue;const text=document.createElement('span');text.className=`card-back-${key}`;text.textContent=String(value);back.append(text);}return;}
 if(!uniforms)return;const previous=uniforms.tBack.value,next=labelTexture(currentLabel,true);uniforms.tBack.value=next;const at=owned.indexOf(previous);if(at>=0)owned[at]=next;else owned.push(next);previous.dispose();wake();
}
async function init(){
  const response=await fetch('./profiles.json');if(!response.ok)throw Error('卡片资源目录不可用');profiles=await response.json();
  try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'default'});}
  catch{
    fallback=document.createElement('div');fallback.className='css-card';
    const front=document.createElement('div'),back=document.createElement('div');front.className='card-front';back.className='card-back';fallback.append(front,back);stage.append(fallback);cardFx=createCSSCardFx(fallback);cardFx.configure(fxOptions);displayStack=createCSSDisplayStack(fallback,id=>{stage.dataset.display=id;});
  }
  if(renderer){
    renderer.setClearColor(0,0);renderer.setPixelRatio(Math.min(2,Math.max(devicePixelRatio,1.5)));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
    camera=new THREE.OrthographicCamera(-6,6,6,-6,.1,100);camera.position.set(0,0,20);stage.append(renderer.domElement);
    uniforms={tSubject:{value:white()},tBackground:{value:white()},tText:{value:transparent()},tLine:{value:white()},tBack:{value:transparent()},tEffects:{value:transparent()},tParts:{value:transparent()},tDetails:{value:transparent()},tFineA:{value:transparent()},tFineB:{value:transparent()},uFace:{value:new THREE.Vector4()},uDetailOffsets:{value:Array.from({length:12},()=>new THREE.Vector2())},uDetailDepthA:{value:new THREE.Vector3()},uDetailDepthB:{value:new THREE.Vector3()},uDetailDepthC:{value:new THREE.Vector3()},uDetailDepthD:{value:new THREE.Vector3()},uDetailStrength:{value:1},uPortal:{value:fxOptions.style==='portal'?1:0},uPortalA:{value:new THREE.Color('#7498ae')},uPortalB:{value:new THREE.Color('#b2a0c6')},uTime:{value:0},uView:{value:new THREE.Vector3(0,0,1)},uFit:{value:new THREE.Vector2(1,1)},uBgFit:{value:new THREE.Vector2(1,1)},uFoil:{value:.3},uScale:{value:1.00},uDepth:{value:.32},uBgDepth:{value:-.22},uSafeScale:{value:1},uSafeOffset:{value:new THREE.Vector2(0,0)},uFxDepth:{value:.48},uHasFx:{value:0},uFxRegistered:{value:0},uFxBehindOnly:{value:0},uFinish:{value:0},uHasLine:{value:0},uRelief:{value:0},uGrounded:{value:0},uContactY:{value:1},uContactDepth:{value:.32},uContactBand:{value:.22},uAutoInk:{value:0}};
    owned=['tSubject','tBackground','tText','tLine','tBack','tParts','tDetails','tFineA','tFineB','tEffects'].map(k=>uniforms[k].value);
    const shader=fragmentShader=>new THREE.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader,side:THREE.FrontSide});
    const materials={web_front:shader(frontFragment),web_back:shader(backFragment),web_edge:shader(edgeFragment),web_gold:new THREE.MeshBasicMaterial({color:'#c9a24a'})};
    model=await new GLTFLoader().loadAsync('./card.glb');root=new THREE.Group();root.add(model.scene);scene.add(root);
    let fronts=0;model.scene.traverse(mesh=>{if(!mesh.isMesh)return;const role=mesh.material?.name;mesh.material.dispose();if(role==='web_text'||role==='web_subject'||role==='web_effects'){mesh.visible=false;return;}if(role==='web_front')fronts++;mesh.material=materials[role]||materials.web_edge;});
    root.name='card-root';displayStack=createDisplayStack(THREE,root,uniforms,id=>{stage.dataset.display=id;foreground?.setNameVisible(id==='none');});
    if(!fronts)throw Error('卡片模型缺少正面');foreground=createForegroundStack(THREE,root,loader,uniforms);cardFx=createCardFx(THREE,scene,root,loader,wake);cardFx.configure(fxOptions);renderer.compile(scene,camera);
    if(renderer.info.programs.some(p=>p.diagnostics&&!p.diagnostics.runnable))throw Error('卡片材质无法显示');
    renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();cancelAnimationFrame(raf);raf=0;tell('error',{message:'图形显示已暂停，可切回原图'});});
  }
  if(uniforms)uniforms.uScale.value=artFit==='full'?1.04:1.00;
  new ResizeObserver(resize).observe(stage);resize();tell('boot');if(pending)await apply(pending);
}
window.addEventListener('message',e=>{
  if(e.origin!==location.origin||e.source!==parent||!e.data||!String(e.data.type).startsWith('hermes-card:'))return;
  const data=e.data;
  if(data.type==='hermes-card:update'){pending=data;if(profiles&&(fallback||root))apply(data).catch(()=>{if(pending?.request===data.request)tell('error',{message:'角色卡暂时无法显示',request:data.request});});}
  if(data.type==='hermes-card:resize'){resize();}
  if(data.type==='hermes-card:effects')setEffects(data);
  if(data.type==='hermes-card:metadata'){if(pending){pending.relationship=data.relationship;pending.affinity=data.affinity;}updateMetadata(data);}
  if(data.type==='hermes-card:environment'){
    active=data.active===true;cardFx?.setActive?.(active);userReduced=data.reduced===true;reduced=os.matches||userReduced;if(reduced&&hovering)release();
    artFit=data.fit==='full'?'full':'scene';stage.dataset.fit=artFit;if(uniforms)uniforms.uScale.value=artFit==='full'?1.04:1.00;
    resize();
    document.documentElement.style.colorScheme=data.scheme==='dark'?'dark':'light';
    if(data.background==='transparent'||typeof data.background==='string'&&/^#[0-9a-f]{6}$/i.test(data.background))document.documentElement.style.backgroundColor=data.background;
    if(!active){release();cancelAnimationFrame(raf);raf=0;}else wake();
  }
  if(data.type==='hermes-card:command'){if(data.command==='flip')flip();if(data.command==='reset')reset();if(data.command==='display'){if(pending)pending.display=data.display;setDisplay(data.display);}if(data.command==='finish'){if(pending)pending.finish=data.finish;setFinish(data.finish);}}
});
// Native image dragging cancels pointer capture in CSS fallback cards.
stage.addEventListener('dragstart',e=>e.preventDefault());
stage.addEventListener('pointerdown',e=>{if(e.button!==0||!gesture.begin(e.pointerId,e.clientX,e.clientY,performance.now(),stage.clientWidth))return;hovering=false;returnAt=0;stage.setPointerCapture(e.pointerId);dragging=true;pointer={x:e.clientX,y:e.clientY};});
stage.addEventListener('pointermove',e=>{
 if(!dragging){if(e.pointerType!=='mouse'||reduced||os.matches||!active)return;const box=stage.getBoundingClientRect();hovering=true;returnAt=0;targetX=THREE.MathUtils.clamp((e.clientY-box.top)/box.height-.5,-.5,.5)*.32;targetY=faceAngle+THREE.MathUtils.clamp((e.clientX-box.left)/box.width-.5,-.5,.5)*.70;wake();return;}
 const movement=gesture.move(e.pointerId,e.clientX,e.clientY,performance.now());if(!movement)return;
 targetY=faceAngle+THREE.MathUtils.clamp(movement.dx/movement.width*2.5,-1.25,1.25);targetX=THREE.MathUtils.clamp(movement.dy*.004,-.3,.3);wake();
});
function release(e){
 if(!dragging&&!hovering)return;
 const intentional=e?.type==='pointerup';const decision=e&&dragging?gesture.end(e.pointerId,e.clientX,e.clientY,performance.now(),!intentional):{flip:false};gesture.cancel();
 hovering=false;dragging=false;if(decision.flip){flip(decision.direction);return;}
 targetX=0;targetY=faceAngle;returnAt=performance.now();returnX=x;returnY=y;returnMs=0;wake();
}
for(const event of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(event,release);
stage.addEventListener('pointerleave',()=>{if(!dragging)release();});
window.addEventListener('blur',()=>release());
stage.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();zoom=THREE.MathUtils.clamp(zoom-e.deltaY*.001,.88,1.12);resize();},{passive:false});
stage.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','f','F','r','R'].includes(e.key))return;e.preventDefault();if(e.key.toLowerCase()==='f')return flip();if(e.key.toLowerCase()==='r')return reset();const base=faceAngle;targetY=THREE.MathUtils.clamp(targetY+(e.key==='ArrowRight'?.1:e.key==='ArrowLeft'?-.1:0),base-.6,base+.6);targetX=THREE.MathUtils.clamp(targetX+(e.key==='ArrowDown'?.07:e.key==='ArrowUp'?-.07:0),-.3,.3);wake();});
os.addEventListener('change',()=>{reduced=os.matches||userReduced;if(reduced&&hovering)release();wake();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){release();cancelAnimationFrame(raf);raf=0;}else wake();});
window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(raf);owned.forEach(t=>t.dispose());foreground?.dispose();displayStack?.dispose();cardFx?.dispose();scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer?.dispose();});
window.__hermesCard={getState:()=>({mode:fallback?'css3d':'webgl',fx:cardFx?.state(camera),active,reduced,flipped,finish,display:displayStack?.state(camera),frames,raf,dragging,x,y,targetX,targetY,returnMs,profileId,subjectFit:uniforms?[uniforms.uFit.value.x,uniforms.uFit.value.y]:fallback?.cardFit,affinityChange:currentLabel?.affinityChange,detailMode:profileId&&!fallback?(detailLabels.length?'clothing-relief-v4':'foreground-planes'):'none',details:detailMotion.snapshot().map(p=>({...p,label:detailLabels.find(d=>d.id===p.id)?.label})),detailCoverage,name:String(pending?.name||'角色'),relationship:currentLabel?.relationship,affinity:currentLabel?.affinity,faceAngle,nameVisible:Math.cos(y)>.08,hovering,foreground:foreground&&camera?foreground.state(camera):[],roleId:pending?.roleId,portrait:pending?.portrait}),probeOcclusion:points=>foreground&&camera?foreground.occlusion(camera,points):[],get root(){return root;},get uniforms(){return uniforms;}};
init().catch(error=>tell('error',{message:error.message}));
