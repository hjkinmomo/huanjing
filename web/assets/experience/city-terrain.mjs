// Stable geography is shared by both urban catalogs. Additional plots grow inland.
export function terrainPlan(entries,parent=null){
 const xs=entries.map(p=>p.x),zs=entries.map(p=>p.z),loX=Math.min(-34,...xs),hiX=Math.max(34,...xs),loZ=Math.min(-24,...zs),hiZ=Math.max(24,...zs);
 const cx=(loX+hiX)/2,cz=(loZ+hiZ)/2,width=hiX-loX+18,depth=hiZ-loZ+18;
 const bank=entries.find(p=>p.kind==='river'),anchor=bank?{x:bank.x-5,z:bank.z}:{x:cx-4,z:cz};
 const river=parent?[]:[{x:anchor.x-6,z:cz-depth/2-3},{x:anchor.x-4,z:cz-depth*.30},{x:anchor.x+1,z:anchor.z-7},{x:anchor.x,z:anchor.z},{x:anchor.x+4,z:cz+depth*.25},{x:anchor.x+8,z:cz+depth/2+6}];
 return {center:{x:cx,z:cz},width,depth,seaSize:Math.max(width,depth)*2.7,river};
}
export function cityTopology(map,parent=null){
 return JSON.stringify([map.worldId,map.version,parent,map.locations.map(p=>[p.id,p.name,p.temporary,p.metadata,p.exits])]);
}
