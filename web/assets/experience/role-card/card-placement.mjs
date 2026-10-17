// Fit a complete connected character without stretching it. Legacy cards retain their framing.
export function subjectFit(aspect,presentation){
 const ratio=Number.isFinite(aspect)&&aspect>0?aspect/(2/3):1;
 if(!presentation)return [Math.min(.84,.84*ratio),Math.min(.80,.80/ratio)];
 const width=Math.min(1,Math.max(.5,Number(presentation.width)||.78));
 const height=Math.min(1,Math.max(.5,Number(presentation.height)||.78));
 const y=Math.min(height,width/ratio);return [y*ratio,y];
}
export function placedPoint(point,fit=[1,1],scale=1){
 const s=Number.isFinite(scale)&&scale>0?scale:1;return [point[0]*fit[0]/s,point[1]*fit[1]/s,point[2]];
}
export const registeredLayer=layer=>['registered','registered-plane'].includes(layer?.kind);

