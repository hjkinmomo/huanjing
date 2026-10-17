// Cursor is a presentation clock, never a delay on storage or model requests.
export const REVEAL_INTERVAL=40;
export const DEFAULT_REVEAL=Object.freeze({intervalMs:40,sceneCharacters:3,dialogueDelayMs:400});
export function normalizeReveal(value={}){
 const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
 return {intervalMs:Math.max(16,Math.min(200,finite(value.intervalMs,40))),sceneCharacters:Math.max(1,Math.min(20,Math.floor(finite(value.sceneCharacters,3)))),dialogueDelayMs:Math.max(0,Math.min(3000,finite(value.dialogueDelayMs,400)))};
}
export function partCost(part,config=DEFAULT_REVEAL){return part.kind==='scene'?Math.max(1,Math.ceil(Array.from(part.text).length/config.sceneCharacters)):Math.max(1,Math.ceil(config.dialogueDelayMs/config.intervalMs));}
export function revealCost(parts,config=DEFAULT_REVEAL){return parts.reduce((n,p)=>n+partCost(p,config),0);}
export function revealedParts(parts,cursor,config=DEFAULT_REVEAL){
 const visible=[];let remaining=Math.max(0,cursor);
 for(const part of parts){const cost=partCost(part,config);if(remaining<=0)break;
  if(part.kind==='scene'){const text=Array.from(part.text).slice(0,Math.min(remaining*config.sceneCharacters,Array.from(part.text).length)).join('');if(text)visible.push({...part,text});}
  else if(remaining>=cost)visible.push(part);
  if(remaining<cost)break;remaining-=cost;
 }return visible;
}
