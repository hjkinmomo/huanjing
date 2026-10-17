export function containsPoint(shape:number[][],point:number[]):boolean;
export function roomShape(room:any):number[][]|null;
export function roomAnchor(room:any,shape:number[][],kind?:string):number[];
export function floorGeometry(page:any):any;
export function wallSegments(geometry:any):{axis:string;fixed:number;start:number;end:number;outer:boolean}[];
export function labelLines(value:string,characters?:number):string[];
