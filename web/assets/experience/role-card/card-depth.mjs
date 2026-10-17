// Raise scene separation at a compact card size. Never lift a garment clasp.
export const NAME_DEPTH=1.20;
export function raisedProfile(profile){
 if(!profile)return profile;
 const p=structuredClone(profile),params=p.parameters||{};
 const attached=(p.foreground||[]).some(layer=>Number.isFinite(layer.anchorDepth));
 // Older garment decorations were registered against these exact print depths.
 // Preserve that calibration rather than lifting the print away from its clasp.
 p.parameters=attached?{...params}:{...params,subjectDepth:Math.min(.72,Math.max(.4,(params.subjectDepth??.28)*1.55)),backgroundDepth:Math.max(-.46,(params.backgroundDepth??-.18)*1.6),effectsDepth:Math.min(1.05,(params.effectsDepth??.52)*1.5)};
 p.foreground=(p.foreground||[]).map(layer=>{
  if(Number.isFinite(layer.anchorDepth))return layer;
  const anchor=0;
  return {...layer,depth:Math.min(1.15,anchor+(layer.depth-anchor)*1.45)};
 });
 return p;
}
export const artworkRoleId=id=>String(id||'').replace(/^special\./,'');
