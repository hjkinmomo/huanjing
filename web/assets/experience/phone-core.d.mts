export const PHONE_APPS:readonly {id:string;name:string;view:string;icon:string;enabled:boolean}[];
export const PHONE_GAMES:readonly {id:string;name:string;note:string;image:string}[];
export function phoneReplyParts(text:string,roleId?:string,streaming?:boolean):any[];
export function phoneMessages<T extends {channel?:string}>(messages:T[]):T[];
export function offlineMessages<T extends {channel?:string}>(messages:T[]):T[];
export function phoneReplyOwner(state:any,key:string,sessions?:Map<string,any>):string|null;
export function phoneUnreadSession(state:any,owner:string,historyCache?:Map<string,any>):null|{key:string;sessionId:string};
export function gameLaunchChoice(active:any,kind:string):'open'|'start'|'resume'|'confirm';
