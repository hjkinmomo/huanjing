import {PARALLAX_LIMITS,depthCompensation} from './parallax-limits.mjs';
// Coordinates are on the complete card print, measured from its top-left.
// A clasp stays close to the print; the free end rises along an oblique path.
export function registeredUV(layer,u,v){const pivot=layer.anchorUV||[.5,.5],scale=layer.spriteScale??1;return [pivot[0]+(u-pivot[0])*scale+(layer.offset?.[0]||0),pivot[1]+(v-pivot[1])*scale+(layer.offset?.[1]||0)];}
export function ornamentPoint(layer,u,v){
 if(layer.kind==='registered'||layer.kind==='registered-plane'){
  const [px,py]=registeredUV(layer,u,v);
  if(layer.kind==='registered-plane')return [(px-.5)*6,(.5-py)*9,layer.depth];
  const dx=layer.tip[0]-layer.anchor[0],dy=layer.tip[1]-layer.anchor[1];
  const t=Math.max(0,Math.min(1,((px-layer.anchor[0])*dx+(py-layer.anchor[1])*dy)/Math.max(.0001,dx*dx+dy*dy)));
  return [(px-.5)*6,(.5-py)*9,layer.anchorDepth+(layer.depth-layer.anchorDepth)*t*t*(3-2*t)];
 }
 if(layer.kind==='plane'){
  const angle=layer.roll||0,dx=(u-.5)*layer.size[0]*6,dy=(.5-v)*layer.size[1]*9;
  return [(layer.center[0]-.5)*6+dx*Math.cos(angle)-dy*Math.sin(angle),(.5-layer.center[1])*9+dx*Math.sin(angle)+dy*Math.cos(angle),layer.depth+.025*Math.sin(u*Math.PI)*Math.sin(v*Math.PI)];
 }
 const [au,av]=layer.anchorUV,t=(v-av)/(1-av);
 const dx=(layer.tip[0]-layer.anchor[0])*6,dy=(layer.anchor[1]-layer.tip[1])*9;
 const length=Math.hypot(dx,dy),across=(u-au)*layer.width*6;
 const progress=Math.max(0,Math.min(1,t)),rise=progress*progress*(3-2*progress);
 return [(layer.anchor[0]-.5)*6+dx*t-dy/length*across,
         (.5-layer.anchor[1])*9+dy*t+dx/length*across,
         layer.anchorDepth+(layer.depth-layer.anchorDepth)*rise+.02*Math.sin(Math.PI*progress)*rise*(1-rise)];
}
// CSS approximates the same anchored slope as a plane. WebGL uses a curved grid.
export function ornamentCSS(layer,width,height,fit=[1,1],scale=1,view=null){
 const a=ornamentPoint(layer,0,0),b=ornamentPoint(layer,1,0),c=ornamentPoint(layer,0,1);
 const registered=['registered','registered-plane'].includes(layer.kind);
 if(registered)for(const point of [a,b,c]){point[0]*=fit[0]/scale;point[1]*=fit[1]/scale;}
 // The planar fallback must pass through the actual clasp, rather than using
 // the curved grid's end samples as an unanchored secant.
 if(layer.kind!=='plane'&&!registered){a[2]=b[2]=layer.anchorDepth-(layer.depth-layer.anchorDepth)*layer.anchorUV[1]/(1-layer.anchorUV[1]);c[2]=layer.depth;}
 if(layer.kind==='registered'){
  const dx=layer.tip[0]-layer.anchor[0],dy=layer.tip[1]-layer.anchor[1],den=dx*dx+dy*dy,rise=layer.depth-layer.anchorDepth;
  for(const [point,u,v]of [[a,0,0],[b,1,0],[c,0,1]]){const [px,py]=registeredUV(layer,u,v);point[2]=layer.anchorDepth+rise*((px-layer.anchor[0])*dx+(py-layer.anchor[1])*dy)/Math.max(.0001,den);}
 }
 if(view){
  const localView=[view[0],-view[1],view[2]],limit=PARALLAX_LIMITS.ornament;
  // The fallback remains an affine plane. Interpolate compensated anchor and
  // free-end samples so an attached clasp stays on its registered point.
  const lo=layer.anchorDepth??layer.depth,hi=layer.depth,ca=depthCompensation(lo,localView,limit),cb=depthCompensation(hi,localView,limit);
  for(const p of [a,b,c]){const t=Math.abs(hi-lo)>.00001?(p[2]-lo)/(hi-lo):0;p[0]+=ca[0]+(cb[0]-ca[0])*t;p[1]+=ca[1]+(cb[1]-ca[1])*t;}
 }
 const sx=width/6,sy=height/9,sz=width/6*(layer.cssDepthScale??1);
 return `matrix3d(${(b[0]-a[0])*sx/width},${-(b[1]-a[1])*sy/width},${(b[2]-a[2])*sz/width},0,${(c[0]-a[0])*sx/height},${-(c[1]-a[1])*sy/height},${(c[2]-a[2])*sz/height},0,0,0,1,0,${(a[0]+3)*sx},${(4.5-a[1])*sy},${a[2]*sz},1)`;
}
