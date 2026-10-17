import {STICKER_MOODS,hasRoleStickers,stickerFor} from './sticker-catalog.mjs';
import {normalizeScene} from './scene-state.mjs';
// Presentation only: one canonical assistant turn remains one history record.
function plainChat(source,roleId){
 // Only split text we can safely recognize as ordinary chat. Markdown may span
 // lines, and an unfinished stream can become valid Markdown on the next delta.
 const inspect=hasRoleStickers(roleId)?source.replace(/\[\[sticker:([a-z]+)\]\]/g,(token,mood)=>stickerFor(roleId,mood)?'':token):source;
 if(/[\t\\`*_~\[\]<>|$]/.test(inspect)||/(^|[\r\n]) {4}| {2,}(?:\r?\n|\r)/.test(inspect))return false;
 return !/(^|[\r\n]) {0,3}(?:#{1,6}(?:\s|$)|[-+](?:\s|$)|\d+[.)、](?:\s|$)|(?:=+|-+)\s*$)/m.test(inspect);
}
function chatParts(source,roleId){
 if(!plainChat(source,roleId))return source?[{kind:'text',text:source}]:[];
 const parts=[],allowed=hasRoleStickers(roleId);
 for(const line of source.split(/\r\n|\r|\n/))for(const text of allowed?line.split(/(\[\[sticker:[a-z]+\]\])/g):[line]){
  const mood=/^\[\[sticker:([a-z]+)\]\]$/.exec(text)?.[1],sticker=mood&&stickerFor(roleId,mood);
  if(sticker)parts.push(sticker);else if(text.trim())parts.push({kind:'text',text});
 }
 return parts;
}
const fenceStart=line=>/^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]||'';
const fenceEnd=(line,fence)=>new RegExp('^ {0,3}'+fence[0]+'{'+fence.length+',}\\s*$').test(line);
// Conservative boundary check: never take a marker out of spanning inline code,
// emphasis or a Markdown link. Ambiguous syntax remains its original source.
function boundary(source){
 let ticks='',depth=0;const emphasis=new Set();
 for(const match of source.matchAll(/(?<!\\)(`+|\*{1,3}|_{1,3}|\[|\])/g)){
  const token=match[0];if(token[0]==='`'){if(!ticks)ticks=token;else if(token===ticks)ticks='';continue;}
  if(ticks)continue;if(token==='[')depth++;else if(token===']')depth=Math.max(0,depth-1);else if(emphasis.has(token))emphasis.delete(token);else emphasis.add(token);
 }
 return !ticks&&!depth&&!emphasis.size;
}
function blockEnd(lines,start,closing){
 let fence='';for(let i=start;i<lines.length;i++){const line=lines[i].replace(/[\r\n]+$/,'');if(fence){if(fenceEnd(line,fence))fence='';continue;}const open=fenceStart(line);if(open){fence=open;continue;}if(line===closing)return i;}return -1;
}
export function replyParts(text,roleId='',streaming=false,presentation=true){
 let source=String(text||'');
 if(!presentation)return chatParts(source,'');
 const markers=['[[scene-state]]','[[/scene-state]]','[[scene]]','[[/scene]]','[[inner]]','[[/inner]]',...(hasRoleStickers(roleId)?Object.keys(STICKER_MOODS).map(key=>`[[sticker:${key}]]`):[])];
 if(streaming){const at=source.lastIndexOf('[[');if(at>=0&&markers.some(token=>token.startsWith(source.slice(at))&&source.slice(at)!==token)&&boundary(source.slice(0,at)))source=source.slice(0,at);
  else if(/(^|[\r\n])\[$/.test(source))source=source.slice(0,-1);}
 const lines=source.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)||[];if(lines.at(-1)==='')lines.pop();
 const parts=[];let buffer='',fence='',stickerUsed=false;
 const append=part=>{if(part.kind==='sticker'){if(stickerUsed)return;stickerUsed=true;}parts.push(part);};
 const flush=()=>{chatParts(buffer,roleId).forEach(append);buffer='';};
 for(let i=0;i<lines.length;i++){
  const raw=lines[i],line=raw.replace(/[\r\n]+$/,'');
  if(fence){buffer+=raw;if(fenceEnd(line,fence))fence='';continue;}
  const open=fenceStart(line);if(open){fence=open;buffer+=raw;continue;}
  const kind=/^\[\[(scene|inner|scene-state)\]\]$/.exec(line)?.[1];
  const mood=/^\[\[sticker:([a-z]+)\]\]$/.exec(line)?.[1],sticker=mood&&stickerFor(roleId,mood);
  if((kind||sticker)&&boundary(buffer)){
   if(sticker){flush();append(sticker);continue;}
   const end=blockEnd(lines,i+1,`[[/${kind}]]`);
   if(kind==='scene-state'){
    if(end<0&&streaming){flush();break;}
    if(end>=0){try{if(normalizeScene(JSON.parse(lines.slice(i+1,end).join('')))){flush();i=end;continue;}}catch{}}
    buffer+=raw;continue;
   }
   if(end>=0||streaming){flush();const body=lines.slice(i+1,end>=0?end:lines.length).join('').replace(/[\r\n]+$/,'');if(body.trim())append({kind,text:body});i=end>=0?end:lines.length;continue;}
  }
  buffer+=raw;
 }
 flush();
 return parts;
}
