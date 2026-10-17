import {STICKER_MOODS} from './sticker-catalog.mjs';
// A feed comment is plain dialogue, never a scene transport or executable markup.
export function cleanMomentLabels(raw){
 const labels=Object.values(STICKER_MOODS).map(m=>m.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 return String(raw||'').replace(new RegExp('^\\s*[（(](?:'+labels.join('|')+')[)）]\\s*$','gm'),'').trim();
}
export function momentReply(raw){
 let value=String(raw||'').trim();
 const fenced=value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
 if(fenced)value=fenced[1];
 if(/^[{[]/.test(value)){
  let data;try{data=JSON.parse(value);}catch{throw Error('动态回应格式不完整，没有发布协议文本。');}
  if(Array.isArray(data?.parts))value=data.parts.filter(p=>p?.kind==='text'&&typeof p.text==='string').map(p=>p.text).join('\n');
  else if(typeof data?.text==='string')value=data.text;
  else if(typeof data?.content==='string')value=data.content;
  else throw Error('动态回应没有可显示的对话。');
 }
 value=cleanMomentLabels(value.replace(/^\s*\[\[sticker:[a-z]+\]\]\s*$/gm,''));
 value=value.replace(/\[\[(?:scene|inner|state|sticker)\]\][\s\S]*?\[\[\/(?:scene|inner|state|sticker)\]\]/g,'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
 if(!value||/\[\[(?:scene|inner|state)\]\]|```|"parts"\s*:|"scene"\s*:/.test(value))throw Error('动态回应包含未完成的格式标记，没有发布。');
 if(value.length>1000)throw Error('动态回应太长，没有截断或发布。');
 return value;
}
