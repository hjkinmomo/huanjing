import {locationHierarchy} from './location-tree.mjs';
import {sceneContainer} from './scene-container.mjs';
// A room is precise position data; its containing home is the visible plan.
export function minimapScope(map,userId){
 const tree=locationHierarchy(map.locations),path=tree.path(userId),place=tree.byId.get(userId);
 if(!place)return null;
 const parent=sceneContainer(map.locations,userId);
 const belongs=id=>tree.path(id).some(p=>p.id===parent);
 const actors=(map.actors||[]).filter(a=>belongs(a.locationId));
 return {parent,map:{...map,actors,actorLocations:{user:userId,character:belongs(map.actorLocations?.character)?map.actorLocations.character:''}}};
}
