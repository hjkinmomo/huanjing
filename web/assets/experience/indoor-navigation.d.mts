import type {WorldMap} from '../../../frontend/src/chat-types';
type Place=WorldMap['locations'][number];
export function indoorNavigation(locations:Place[],viewId:string,userId:string):{floor?:Place;floors:Place[];previousFloor:Place|null;nextFloor:Place|null;parent:string|null;children:Place[];previousScene:Place|null;nextScene:Place|null;path:Place[]};
