import {DISPLAY_DEPTH} from '../card-display-config.mjs';
import {PARALLAX_LIMITS} from './parallax-limits.mjs';

// Pixel islands are extracted at the transparent gaps. Their original pixels
// remain unchanged; every island has its own placement and material plane.
const cache=new Map();
export function identifyDisplayIslands(pixels,width,height,minPixels=256){
 const labels=new Int32Array(width*height),queue=new Int32Array(width*height),islands=[];let id=0;
 for(let first=0;first<labels.length;first++){
  if(labels[first]||pixels[first*4+3]<12)continue;
  id++;let head=0,tail=1;queue[0]=first;labels[first]=id;
  let left=first%width,right=left,top=Math.floor(first/width),bottom=top;
  while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
   for(const next of [x?i-1:-1,x<width-1?i+1:-1,y?i-width:-1,y<height-1?i+width:-1])if(next>=0&&!labels[next]&&pixels[next*4+3]>=12){labels[next]=id;queue[tail++]=next;}
  }
  if(tail>=minPixels)islands.push({id,pixels:tail,box:[Math.max(0,left-2),Math.max(0,top-2),Math.min(width,right+3),Math.min(height,bottom+3)]});
 }
 return {labels,islands};
}

export function displayIslandPlacement(box,spec){
 const [left,top,right,bottom]=box,cx=(left+right)/2,cy=(top+bottom)/2,w=right-left,h=bottom-top;
 const name=w>.30&&cy>.79&&cx>.25&&cx<.75;
 const scale=name?.90:(top<.06&&w>.28)?.88:1;
 let sourceAnchor,targetAnchor;
 if(name){sourceAnchor=spec.nameAt;targetAnchor=[.5,.97];}
 else if(top<.06&&w>.28){const side=cx>.55?1:0;sourceAnchor=[side?.955:.06,.045];targetAnchor=[side,0];}
 else if(left<.31&&cy>.75){sourceAnchor=[.06,.95];targetAnchor=[0,1];}
 else if(left>.65&&cy>.70){sourceAnchor=[.955,.95];targetAnchor=[1,1];}
 else if(cx<.3){sourceAnchor=[.06,cy];targetAnchor=[0,Math.max(.05,Math.min(.95,(cy-.045)/.905))];}
 else if(cx>.7){sourceAnchor=[.955,cy];targetAnchor=[1,Math.max(.05,Math.min(.95,(cy-.045)/.905))];}
 else{sourceAnchor=[cx,.045];targetAnchor=[cx,0];}
 const x=targetAnchor[0]+(left-sourceAnchor[0])*scale,y=targetAnchor[1]+(top-sourceAnchor[1])*scale;
 const result={kind:name?'nameplate':'ornament',rect:[x,y,x+w*scale,y+h*scale],depth:name?1.35:1.08,limit:name?PARALLAX_LIMITS.name:PARALLAX_LIMITS.corner};
 const override=spec.assemblyOverrides?.find(p=>Array.isArray(p.sourceBox)&&p.sourceBox.length===4&&box.every((v,i)=>Math.abs(v-p.sourceBox[i])<.002));
 if(override){const r=override.rect;if(Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r[2]>r[0]&&r[3]>r[1])result.rect=[...r];if(Number.isFinite(override.depth)&&override.depth>=0)result.depth=override.depth;if(Number.isFinite(override.limit)&&override.limit>=0)result.limit=override.limit;}
 return result;
}

export function displayRailPlacements(){
 // One boundary for all four strips: no per-side stretching or shifting.
 const half=.0035,halfY=half*2/3;
 return [
  {id:'edge-top',rect:[-half,-halfY,1+half,halfY],axis:'horizontal'},
  {id:'edge-bottom',rect:[-half,1-halfY,1+half,1+halfY],axis:'horizontal'},
  {id:'edge-left',rect:[-half,-halfY,half,1+halfY],axis:'vertical'},
  {id:'edge-right',rect:[1-half,-halfY,1+half,1+halfY],axis:'vertical'}
 ].map(p=>({...p,kind:'rail',depth:DISPLAY_DEPTH,limit:PARALLAX_LIMITS.trim}));
}

function splitArtwork(image){
 if(cache.has(image.src))return cache.get(image.src);
 const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
 const pixels=ctx.getImageData(0,0,c.width,c.height),{labels,islands}=identifyDisplayIslands(pixels.data,c.width,c.height);
 const parts=islands.map(island=>{
  const [left,top,right,bottom]=island.box,sprite=document.createElement('canvas');sprite.width=right-left;sprite.height=bottom-top;const out=sprite.getContext('2d'),data=out.createImageData(sprite.width,sprite.height);
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const source=y*c.width+x,alpha=pixels.data[source*4+3];if(!alpha)continue;
   const own=labels[source]===island.id||(!labels[source]&&[source-1,source+1,source-c.width,source+c.width].some(i=>i>=0&&i<labels.length&&labels[i]===island.id));if(!own)continue;
   const dest=((y-top)*sprite.width+x-left)*4;data.data.set(pixels.data.subarray(source*4,source*4+4),dest);
  }
  out.putImageData(data,0,0);return {sourceId:island.id,canvas:sprite,box:[left/c.width,top/c.height,right/c.width,bottom/c.height]};
 });
 if(cache.size>=3)cache.delete(cache.keys().next().value);cache.set(image.src,parts);return parts;
}

function railTexture(axis,spec){
 const canvas=document.createElement('canvas');canvas.width=axis==='horizontal'?512:24;canvas.height=axis==='horizontal'?24:512;const ctx=canvas.getContext('2d');
 const across=ctx.createLinearGradient(0,0,axis==='horizontal'?0:24,axis==='horizontal'?24:0);
 const colors=spec.id==='moon-silver'?['#70684f','#e4dbb9','#fffdeb','#b7a87c','#eee6c9','#766343']:['#76552d','#d4b474','#fff2c7','#b08d4d','#f1d79b','#795631'];
 colors.forEach((color,i)=>across.addColorStop(i/(colors.length-1),color));ctx.fillStyle=across;ctx.fillRect(0,0,canvas.width,canvas.height);
 const glint=ctx.createLinearGradient(0,0,canvas.width,canvas.height);glint.addColorStop(0,'#fff0');glint.addColorStop(.38,'#fff0');glint.addColorStop(.50,'#fff6');glint.addColorStop(.62,'#fff0');glint.addColorStop(1,'#fff0');ctx.fillStyle=glint;ctx.fillRect(0,0,canvas.width,canvas.height);return canvas;
}

export function assembleDisplay(image,spec,name){
 const pieces=splitArtwork(image).map((part,index)=>{
  const placement=displayIslandPlacement(part.box,spec);let canvas=part.canvas;
  if(placement.kind==='nameplate'){
   canvas=document.createElement('canvas');canvas.width=part.canvas.width;canvas.height=part.canvas.height;const ctx=canvas.getContext('2d');ctx.drawImage(part.canvas,0,0);
   let text=String(name||'角色').slice(0,60),size=68;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`${size}px "KaiTi","Microsoft YaHei",serif`;
   while(ctx.measureText(text).width>canvas.width*.70&&size>26){size-=2;ctx.font=`${size}px "KaiTi","Microsoft YaHei",serif`;}
   if(ctx.measureText(text).width>canvas.width*.70){const chars=Array.from(text);while(chars.length&&ctx.measureText(chars.join('')+'…').width>canvas.width*.70)chars.pop();text=chars.join('')+'…';}
   ctx.fillStyle=spec.ink;ctx.shadowColor=spec.id==='pearl-ribbon'?'#fff':'#132238';ctx.shadowBlur=2;ctx.fillText(text,(spec.nameAt[0]-part.box[0])*image.naturalWidth,(spec.nameAt[1]-part.box[1])*image.naturalHeight);
  }
  return {id:placement.kind==='nameplate'?'nameplate':`ornament-${index+1}`,sourceBox:part.box,canvas,...placement};
 });
 return [...displayRailPlacements().map(p=>({...p,canvas:railTexture(p.axis,spec)})),...pieces];
}

export function drawDisplayPreview(canvas,pieces){
 canvas.width=1280;canvas.height=1920;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
 for(const piece of pieces){const [l,t,r,b]=piece.rect;ctx.drawImage(piece.canvas,128+l*1024,192+t*1536,(r-l)*1024,(b-t)*1536);}
}
