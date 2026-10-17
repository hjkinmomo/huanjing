// Protocol-only recovery. Never evaluate text, infer dialogue, or rewrite inside strings.
const absent=Symbol('absent');
const keys=new Set(['character','parts','scene','kind','text','location','setting','activity','outfit','mood']);
function bounded(value){
 const stack=[{value,depth:0}];let count=0;
 while(stack.length){const item=stack.pop();if(++count>4096||item.depth>12)throw Error('scene_json_depth');if(item.value&&typeof item.value==='object')for(const next of Object.values(item.value))stack.push({value:next,depth:item.depth+1});}
 return value;
}
export function decodeSceneJSON(input){
 if(typeof input!=='string'||input.length>32000)throw Error('scene_json_size');
 let source=input.trim(),repairs=0,truncated=false;
 const fix=()=>{if(++repairs>32)throw Error('scene_json_repairs');};
 const fenced=/^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(source);
 if(fenced){source=fenced[1];fix();}
 try{return {value:bounded(JSON.parse(source)),repairs,truncated};}catch{}
 const tokens=[];
 for(let i=0;i<source.length;){
  if(/\s/.test(source[i])){i++;continue;}
  if(tokens.length>=4096)throw Error('scene_json_tokens');
  if(source[i]==='"'){
   let raw='"',closed=false;i++;
   for(;i<source.length;i++){
    const c=source[i];
    if(c==='\\'){raw+=c;if(i+1<source.length)raw+=source[++i];continue;}
    if(c==='"'){raw+=c;i++;closed=true;break;}
    if(c.charCodeAt(0)<32){raw+=JSON.stringify(c).slice(1,-1);fix();}else raw+=c;
   }
   if(!closed){truncated=true;break;}
   tokens.push({type:'string',value:JSON.parse(raw)});continue;
  }
  if('{}[]:,'.includes(source[i])){tokens.push({type:source[i++]});continue;}
  const literal=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=[\s,}\]]|$)/.exec(source.slice(i));
  if(!literal)throw Error('scene_json_token');
  tokens.push({type:'value',value:JSON.parse(literal[0])});i+=literal[0].length;
 }
 let at=0;
 const peek=()=>tokens[at]?.type;
 function value(depth=0){
  if(depth>12)throw Error('scene_json_depth');
  const token=tokens[at++];if(!token){truncated=true;return absent;}
  if(token.type==='string'||token.type==='value')return token.value;
  if(token.type==='['){
   const result=[];
   while(at<tokens.length&&peek()!==']'){
    const item=value(depth+1);if(item!==absent)result.push(item);
    if(peek()===','){at++;if(peek()===']')fix();}
    else if(peek()!==']'&&at<tokens.length){if(!['{','[','string','value'].includes(peek()))throw Error('scene_json_array');fix();}
   }
   if(peek()===']')at++;else{fix();truncated=true;}return result;
  }
  if(token.type==='{'){
   const result={};
   while(at<tokens.length&&peek()!=='}'){
    const key=tokens[at++];if(key.type!=='string')throw Error('scene_json_key');
    // Observed provider typo: "text","text":... . No global string replacements.
    while(peek()===','&&tokens[at+1]?.type==='string'&&tokens[at+1].value===key.value&&tokens[at+2]?.type===':'){
     at+=2;fix();
    }
    if(peek()===':')at++;
    else if(keys.has(key.value)&&['string','value','{','['].includes(peek()))fix();
    else if(at>=tokens.length){truncated=true;break;}else throw Error('scene_json_colon');
    const next=value(depth+1);
    if(next!==absent){if(Object.hasOwn(result,key.value))throw Error('scene_json_duplicate');Object.defineProperty(result,key.value,{value:next,enumerable:true,writable:true,configurable:true});}
    // Observed provider typo: {"kind":"text":"actual words"}.
    if(key.value==='kind'&&['text','scene','inner','sticker'].includes(next)&&peek()===':'&&tokens[at+1]?.type==='string'){
     at++;result.text=value(depth+1);fix();
    }
    if(peek()===','){at++;if(peek()==='}')fix();}
    else if(peek()!=='}'&&at<tokens.length){
     if(peek()!=='string'||!keys.has(tokens[at].value))throw Error('scene_json_comma');fix();
    }
   }
   if(peek()==='}')at++;else{fix();truncated=true;}return result;
  }
  throw Error('scene_json_value');
 }
 const result=value();if(at<tokens.length||result===absent)throw Error('scene_json_trailing');
 return {value:result,repairs,truncated};
}
