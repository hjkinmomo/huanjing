// A floor contact is a shallow part of the actor, never the distant backdrop.
// Keep the connected pose almost rigid so feet cannot move against the torso.
const bounded=(value,fallback,low,high)=>Number.isFinite(value)?Math.min(high,Math.max(low,value)):fallback;
export function supportMotion(profile,registered=true){
 const depth=Number.isFinite(profile?.parameters?.subjectDepth)?profile.parameters.subjectDepth:.12;
 const support=profile?.support,grounded=registered&&support?.kind==='grounded';
 const mobility=grounded?bounded(support.contactMobility,.82,.65,1):1;
 return {
  grounded:grounded?1:0,
  contactY:bounded(support?.contactY,1,.5,1),
  contactBand:bounded(support?.contactBand,.22,.08,.32),
  contactDepth:depth*mobility,
  // CSS cannot warp a connected cutout. Move the whole pose at actor depth.
  fallbackDepth:depth,
 };
}
