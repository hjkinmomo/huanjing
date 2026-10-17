import {locationHierarchy} from './location-tree.mjs';
// Deepest explicit household wins; a venue container must contain itself too.
export function sceneContainer(locations,id){
 const tree=locationHierarchy(locations||[]),place=tree.byId.get(id);if(!place)return null;
 const marked=tree.path(id).filter(p=>p.metadata?.planScope===true||p.metadata?.kind==='home'||p.id==='home').at(-1);
 return marked?.id||(tree.children(id).length?id:tree.parent(place)||id);
}
