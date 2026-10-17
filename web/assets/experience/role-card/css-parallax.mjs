import {PARALLAX_LIMITS} from './parallax-limits.mjs';
// Match the shader's card-local view direction in the clipped CSS front.
// Native CSS preserve-3d is flattened by overflow:hidden, so print layers need
// an explicit offset. The foreground/name remain real sibling 3D planes.
export function cssParallax(x,y,depth,width,height){
 const z=Math.max(Math.abs(Math.cos(x)*Math.cos(y)),.4);
 const clamp=(value,limit)=>Math.max(-limit,Math.min(limit,value));
 return [clamp(Math.sin(y)*Math.cos(x)/z*depth*.1,PARALLAX_LIMITS.printX)*width,
         clamp(Math.sin(x)/z*depth*.1,PARALLAX_LIMITS.printY)*height];
}
