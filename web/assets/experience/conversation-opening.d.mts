export type OpeningStage='new'|'familiar'|'trusted'|'intimate'|'romantic';
export type OpeningVariant='1'|'2'|'3'|'4'|'5';
export type ConversationOpening={stage:OpeningStage;scenario:string;variant?:OpeningVariant;world?:{id:string;location:string}};
export const RELATIONSHIP_OPENINGS:readonly {id:OpeningStage;label:string;hint:string;guidance:string}[];
export const OPENING_VARIANTS:readonly {id:OpeningVariant;guidance:string}[];
export function normalizeOpening(value:unknown):ConversationOpening|null;
export function openingMessage(value:unknown):{role:'system';content:string}|null;
