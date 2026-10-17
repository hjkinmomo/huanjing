export type PresentationPolicy={
 narrationModes:{id:'off'|'scene'|'inner';label:string;guidance:string}[];
 narrationRules:string[];
 sharedGuidance:string;
 reasoningLanguagePrompt:string;
 reveal:{intervalMs:number;sceneCharacters:number;dialogueDelayMs:number};
 stickers:{moods:Record<string,{label:string;use:string}>;voices:Record<string,string>;rules:string[]};
};
export let presentationPolicy:PresentationPolicy;
export let NARRATION_MODES:readonly Readonly<PresentationPolicy['narrationModes'][number]>[];
export function setPresentationPolicy(value:PresentationPolicy):void;
export function normalizeNarration(value:unknown):'off'|'scene'|'inner';
export function narrationPrompt(value:unknown):string;
