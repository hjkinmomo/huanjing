export interface CardFxPreferences {palette:string;color:string;dragEffects:boolean}
export const FX_PALETTES: ReadonlyArray<{id:string;label:string}>;
export function normalizeCardFx(value?:Partial<CardFxPreferences>|null):CardFxPreferences;
export function validFxColor(value:unknown):boolean;
export function fxColors(value?:Partial<CardFxPreferences>,themeColor?:string):string[];
export function changeCardFx(state:{display?:Record<string,Record<string,unknown>>},role:{id:string},patch:Partial<CardFxPreferences>):void;
export function selectedCardFx(state:{display?:Record<string,Record<string,unknown>>},role:{id:string}):CardFxPreferences;
export function createFxMotion():{
 step(dt:number,tilt:number,dragging:boolean,reduced?:boolean):{energy:number;direction:number};
 clear():void;snapshot():{energy:number;direction:number};
};
