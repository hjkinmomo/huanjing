export type TreePlace={id:string;name:string;aliases?:string[];metadata?:{parentId?:string;kind?:string;district?:string}};
export function locationHierarchy<T extends TreePlace>(locations:T[]):{byId:Map<string,T>;parent:(p:T|undefined)=>string|null;path:(id:string)=>T[];children:(id?:string|null)=>T[];roots:T[];label:(id:string)=>string};
