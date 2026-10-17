export const localPhotos:{list:()=>Promise<any[]>;save:(p:any)=>Promise<any>;remove:(id:string)=>Promise<any>};
export const localNotes:{read:(id:string)=>Promise<any>;save:(note:any)=>Promise<any>};
export const localMedia:{list:()=>Promise<any[]>;read:(id:string)=>Promise<any>;save:(p:any)=>Promise<any>;remove:(id:string)=>Promise<any>};
export const localAlbum:{deleted:()=>Promise<any[]>;recycle:(ids:string[])=>Promise<any>;restore:(ids:string[])=>Promise<any>};
export function photoOwner(snapshot:any):string;
export function captureScene(node:HTMLElement,snapshot:any):Promise<any>;
