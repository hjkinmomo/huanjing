// District selection changes emphasis, never the catalog or geometry.
export function cityEmphasis(place,district=''){
 const dimmed=!!district&&(place.metadata?.district||'临时地点')!==district;
 return {visible:true,opacity:dimmed?.25:1,dimmed};
}
export function applyCityEmphasis(group,place,district=''){
 const value=cityEmphasis(place,district);group.visible=true;
 group.traverse(o=>{if(!o.isMesh||o.userData?.locationId)return;
  if(!o.userData.cityLocalMaterials){o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();o.userData.cityLocalMaterials=true;}
  for(const m of [].concat(o.material)){m.transparent=value.dimmed;m.opacity=value.opacity;m.depthWrite=!value.dimmed;m.needsUpdate=true;}
 });return value;
}
