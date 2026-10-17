export function phonePreferences():any;
export function savePhonePreferences(patch:any):any;
export function importWallpaper(file:File,options?:{mode?:string;source?:string}):Promise<any>;
export function notificationSound(preview?:boolean|Event):void;
export function notificationWorldClock(worldUtc?:string,offset?:number):void;
export function unlockPhoneAudio():void;
