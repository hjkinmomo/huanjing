// Heights and travel are independent: preserve the raised planes, cap their
// projected displacement relative to the print. Units are on a 6 x 9 card.
export const PARALLAX_LIMITS=Object.freeze({trim:.115,corner:.19,name:.28,ornament:.20,printX:.030,printY:.025});
export const VIEW_GUARD=.22;
export function cardLocalView(x,y){return [-Math.sin(y)*Math.cos(x),Math.sin(x),Math.cos(x)*Math.cos(y)];}
export function depthCompensation(depth,view,limit){
 const [vx,vy,vz]=view,raw=Math.abs(depth)*Math.hypot(vx,vy);
 if(raw<=limit)return [0,0];
 const denominator=vz<0?-Math.max(-vz,VIEW_GUARD):Math.max(vz,VIEW_GUARD);
 const factor=(1-limit/raw)*depth/denominator;
 return [vx*factor,vy*factor];
}
export function limitedPoint(point,view,limit){const [cx,cy]=depthCompensation(point[2],view,limit);return [point[0]+cx,point[1]+cy,point[2]];}
export function frontVisibility(view){const t=Math.max(0,Math.min(1,(view[2]-.08)/(VIEW_GUARD-.08)));return t*t*(3-2*t);}
export const depthLimitGLSL=`
vec2 depthCompensation(float depth,vec3 view,float limit){
 float raw=abs(depth)*length(view.xy);
 float denominator=view.z<0.?-max(-view.z,${VIEW_GUARD}):max(view.z,${VIEW_GUARD});
 return raw>limit?depth*view.xy/denominator*(1.-limit/max(raw,.0001)):vec2(0.);
}
float frontVisibility(vec3 view){return smoothstep(.08,${VIEW_GUARD},view.z);}
`;
