import {emotionLayer,exampleGuidance} from './emotion-state.mjs';
const record=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const clean=(x,n=1600)=>typeof x==='string'?x.slice(0,n):'';
export const SHIRA_SKILLS=Object.freeze([
  {id:'presence',name:'安静陪伴',rule:'先回应用户具体感受。允许只倾听；不要把倾诉改成任务清单，不表演嘴硬、不催振作。'},
  {id:'taste',name:'审美协作',rule:'创作时先理解用途，再带着成熟、舒展、细节克制的个人审美给出方案；不强行把所有作品改成酒红色。'},
  {id:'partner',name:'有主见的搭档',rule:'需要办事时给明确判断和理由，保留温和的个人口吻。可以提出用户未要求的小创意，但有副作用的额外行动必须先获得确认。'},
  {id:'playful',name:'自然亲近',rule:'轻松闲聊可用从容的幽默、成熟的色气调侃与直白的魅力。不固定频率使用称呼或口癖，不假定关系、不索取认可；用户难受时停止调侃。'}
]);
export function eligibleMemories(source,id){
  const list=source.typedMemories?.[id];
  if(!Array.isArray(list))return [];
  return list.filter(m=>record(m) && typeof m.text==='string' && m.text.trim() && m.active!==false && (m.status??'active')==='active' && m.confirmed!==false &&
    !/\b(?:qa|test|fixture)\b|测试|验收|round\s*\d/i.test(`${m.type||''} ${m.source||''}`) &&
    ((m.confirmed===true && m.source==='user') || !/\b(?:qa|test|fixture)\b|测试|验收|round\s*\d/i.test(m.text)) &&
    (m.confirmed===true || m.source==='user'));
}
function relevance(value,query){
  const haystack=value.toLocaleLowerCase(),q=clean(query,4000).toLocaleLowerCase();
  const tokens=new Set(q.match(/[a-z0-9_-]{3,}/g)||[]);
  for(const run of q.match(/[\u4e00-\u9fff]+/g)||[])for(let i=0;i<run.length-1;i++)tokens.add(run.slice(i,i+2));
  return [...tokens].reduce((n,t)=>n+(haystack.includes(t)?1:0),0);
}
export function selectMemories(source,id,query,consent){
  if(consent!==true)return [];
  let remaining=4500,evidenceRemaining=2000;
  return eligibleMemories(source,id).map((m,index)=>({m,index,score:relevance(m.text,query)}))
    .filter(({m,score})=>score>0 || m.pinned===true || m.type==='boundary')
    .sort((a,b)=>Number(b.m.type==='boundary')-Number(a.m.type==='boundary')||Number(b.m.pinned===true)-Number(a.m.pinned===true)||b.score-a.score || a.index-b.index).slice(0,5).flatMap(({m})=>{
      if(!remaining)return [];const text=clean(m.text,Math.min(m.type==='boundary'?1600:1500,remaining));remaining-=text.length;
      const evidence=Array.isArray(m.evidence)?m.evidence.slice(0,3).filter(e=>record(e)&&e.roleId===id&&e.speaker==='user').flatMap(e=>{if(!evidenceRemaining)return [];const quote=clean(e.quote,Math.min(500,evidenceRemaining));evidenceRemaining-=quote.length;return [{roleId:id,messageId:clean(e.messageId,120),speaker:'user',quote,truncated:quote.length<(typeof e.quote==='string'?e.quote.length:0)}];}):[];
      return [{id:clean(m.id,100),text,truncated:text.length<m.text.length,originalCharacters:m.text.length,type:['fact','preference','fiction','boundary'].includes(m.type)?m.type:/lore|worldbook/i.test(`${m.type||''} ${m.source||''} ${m.originSource||''}`)?'fiction':clean(m.type,40),originSource:clean(m.originSource,100),evidence,source:clean(m.source,100),at:clean(m.at,50),confidence:Number.isFinite(m.confidence)?Math.max(0,Math.min(1,m.confidence)):null,kind:'saved-record-not-independent-proof'}];
    });
}
export function relationshipLayer(role,source){
  const policy=role.card?.extensions?.['hermes/relationship'];
  const saved=source.relationshipProfiles?.[role.id];
  const candidate=record(saved)&&typeof saved.stage==='string'&&saved.stage?saved.stage:policy?.currentStage;
  const stage=['new','familiar','trusted','intimate'].includes(candidate)?candidate:'new';
  return {stage,basis:record(saved)&&['new','familiar','trusted','intimate'].includes(saved.stage)?'explicit-user-state':policy?.currentStage===stage?'character-card':'safe-default',
    behavior:clean(policy?.stages?.[stage]?.behavior,500),romance:'not-inferred-from-affection',canon:'follow-current-user-authored-character-relations'};
}
export function characterMode(text){
  if(/难受|伤心|害怕|焦虑|累了|失落|自责|不开心|崩溃|陪陪|安慰/.test(text))return {id:'comfort',label:'倾听陪伴',expression:'温和、直接、少建议；不把脆弱当作调情时机。'};
  if(/设计|创作|写作|小说|布局|配色|美化/.test(text))return {id:'creative',label:'创作协作',expression:'舒展而有主见，围绕用户目标解释审美选择。'};
  if(/任务|工作|代码|计划|整理|清理|日程|查找|分析/.test(text))return {id:'work',label:'处理事情',expression:'从容、清楚，有自己的判断但不假装已经执行。'};
  return {id:'casual',label:'日常相处',expression:'放松自然，允许停顿和轻快幽默，不强制输出步骤。'};
}
export function roleHelpersEnabled(role,settings={}){return settings.roleSkills!==false&&role.card?.roleSkillMode!=='off'&&role.card?.extensions?.['hermes/roleplay']?.enabled!==false;}
export function characterLayers(role,source,text,settings={}){
  const adaptive=role.card?.expressionMode==='adaptive',mode=adaptive?characterMode(text):{id:'character',label:'遵循角色',expression:''},roleplay=role.card?.extensions?.['hermes/roleplay'],disabled=roleplay?.disabledSkills;
  const roleplayEnabled=roleHelpersEnabled(role,settings);
  const skills=role.id==='shira' && roleplayEnabled?
    SHIRA_SKILLS.filter(s=>!Array.isArray(disabled)||!disabled.includes(s.id)):[];
  return {schema:'hermes-character-context-v1',relationship:relationshipLayer(role,source),emotion:emotionLayer(role,source),dialogueExamples:roleplayEnabled?exampleGuidance(role):{examples:[],purpose:'已关闭内置扮演示例。'},
    expression:{...mode,enabled:role.card?.expressionMode!=='off',expression:role.card?.expressionMode==='off'?'':clean(role.card?.emotionGuidance,2000)||mode.expression,priority:'subordinate-to-current-character',kind:'heuristic-response-guidance-not-diagnosis-or-persisted-emotion'},
    skills,memories:selectMemories(source,role.id,text,settings.memoryContext),
    memoryConsent:settings.memoryContext===true,
    modalities:{text:'connected',imageUnderstanding:'not-connected',audioUnderstanding:'not-connected',speechOutput:'not-connected'}};
}

