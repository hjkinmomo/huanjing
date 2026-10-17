import {locationHierarchy} from './location-tree.mjs';
export function indoorNavigation(locations,viewId,userId){
 const tree=locationHierarchy(locations),path=tree.path(viewId),userPath=tree.path(userId),floor=path.find(p=>p.metadata?.kind==='floor')||userPath.find(p=>p.metadata?.kind==='floor'),building=floor?tree.parent(floor):path.find(p=>p.metadata?.kind==='building')?.id;
 const floors=building?tree.children(building).filter(p=>p.metadata?.kind==='floor'):[],index=floors.findIndex(p=>p.id===floor?.id),place=tree.byId.get(viewId),parent=tree.parent(place),siblings=tree.children(parent),sceneIndex=siblings.findIndex(p=>p.id===viewId);
 return {floor,floors,previousFloor:floors[index-1]||null,nextFloor:floors[index+1]||null,parent,children:tree.children(viewId),previousScene:siblings[sceneIndex-1]||null,nextScene:siblings[sceneIndex+1]||null,path};
}
