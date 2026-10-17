export type NearbyRoomRequest={mode:string;originId:string;locationId:string;identityId:string;requestId:string};
export function nearbyRoom(locations:any[],originId?:string,locationId?:string):any|null;
export function requestNearbyRoom(request:Omit<NearbyRoomRequest,'requestId'>):void;
export function openWorldDestination(life:any,mode:string,locationId:string,openTravel:(id:string)=>void,openRoom?:(request:Omit<NearbyRoomRequest,'requestId'>)=>void):'room'|'travel';
export function moveNearbyRoom(request:NearbyRoomRequest&{api:any}):Promise<any>;
export function applyRoomMove(options:{api:any;request:NearbyRoomRequest;exclusive:(run:()=>Promise<any>)=>Promise<any>;validate?:()=>void;refresh?:(result:any)=>any}):Promise<any>;
