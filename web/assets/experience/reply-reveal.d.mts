import type {ReplyPart} from './reply-parts.mjs';
export const REVEAL_INTERVAL:number;
export type RevealConfig={intervalMs:number;sceneCharacters:number;dialogueDelayMs:number};
export const DEFAULT_REVEAL:RevealConfig;
export function normalizeReveal(value?:Partial<RevealConfig>):RevealConfig;
export function partCost(part:ReplyPart,config?:RevealConfig):number;
export function revealCost(parts:ReplyPart[],config?:RevealConfig):number;
export function revealedParts(parts:ReplyPart[],cursor:number,config?:RevealConfig):ReplyPart[];
