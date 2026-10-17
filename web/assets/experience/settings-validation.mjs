import {normalizeAppScale} from './app-scale.mjs';
import {CONTEXT_WINDOWS,DEFAULT_CONTEXT_WINDOW} from './token-budget.mjs';
import {normalizeReplyStyle,REPLY_STYLES} from './reply-style.mjs';
import {THEME_IDS} from './themes.mjs?v=1';
import {normalizeNarration,NARRATION_MODES} from './chat-presentation.mjs';
export const APPEARANCE_FIELDS=['theme','fontScale','sendKey','reducedMotion','themeDetail','themeWidget','themeChoiceVersion','density','sceneDockEnabled','sceneDockCoins','sceneDockLocked','sceneDockSize','appScale'];
export const MODEL_FIELDS=['baseUrl','model','thinking'];
export const ROLE_SETTING_FIELDS=['memoryContext','roleSkills','replyStickers','replyNarration','contextCompression','contextBudget','contextWindow','replyStyle'];
const pick=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));
export function validatedAppearance(values){
  return pick(validatedSettings({...values,baseUrl:'',model:'',contextBudget:24000,replyStyle:'natural',replyNarration:'scene'}),APPEARANCE_FIELDS);
}
export function validatedModelSettings(values){
  return pick(validatedSettings({...values,theme:'light',fontScale:'medium',sendKey:'enter',themeDetail:'pattern',contextBudget:24000,replyStyle:'natural',replyNarration:'scene'}),MODEL_FIELDS);
}
export function validatedRoleSettings(values){
  const result=pick(validatedSettings({...values,theme:'light',fontScale:'medium',sendKey:'enter',themeDetail:'pattern',baseUrl:'',model:''}),ROLE_SETTING_FIELDS);
  if(values.contextWindow===undefined)delete result.contextWindow;
  return result;
}
export function settingsDraft(values) {
  const draft={theme:values.theme,fontScale:values.fontScale,sendKey:values.sendKey||'enter',reducedMotion:!!values.reducedMotion,memoryContext:values.memoryContext===true,roleSkills:values.roleSkills!==false,contextCompression:values.contextCompression!==false,contextBudget:[8000,16000,24000].includes(Number(values.contextBudget))?Number(values.contextBudget):24000,model:String(values.model||'').slice(0,160)};
  // Invalid/credential-bearing addresses remain only in the current input, not storage.
  draft.contextWindow=CONTEXT_WINDOWS.includes(Number(values.contextWindow))?Number(values.contextWindow):DEFAULT_CONTEXT_WINDOW;
  draft.themeDetail=['quiet','pattern','sticker'].includes(values.themeDetail)?values.themeDetail:'pattern';draft.themeWidget=values.themeWidget!==false;
  draft.replyStyle=normalizeReplyStyle(values.replyStyle);
  draft.thinking=values.thinking===true;
  draft.replyStickers=values.replyStickers!==false;
  draft.replyNarration=normalizeNarration(values.replyNarration);
  try {const endpoint=new URL(String(values.baseUrl||''));if(['http:','https:'].includes(endpoint.protocol)&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash)draft.baseUrl=String(values.baseUrl).trim();}catch{}
  return draft;
}
export function validatedSettings(values) {
  const result={theme:values.theme,fontScale:values.fontScale,sendKey:values.sendKey||'enter',reducedMotion:!!values.reducedMotion,memoryContext:values.memoryContext===true,roleSkills:values.roleSkills!==false,contextCompression:values.contextCompression!==false,contextBudget:values.contextBudget===undefined?24000:Number(values.contextBudget),baseUrl:String(values.baseUrl||'').trim(),model:String(values.model||'').trim()};
  result.contextWindow=values.contextWindow===undefined?DEFAULT_CONTEXT_WINDOW:Number(values.contextWindow);if(!CONTEXT_WINDOWS.includes(result.contextWindow))throw Error('请选择有效的模型上下文窗口。');
  result.replyStyle=values.replyStyle||'natural';if(!REPLY_STYLES.includes(result.replyStyle))throw Error('请选择有效的回复习惯。');
  if(![8000,16000,24000].includes(result.contextBudget))throw Error('请选择有效的对话预算。');
  result.themeDetail=values.themeDetail||'pattern';result.themeWidget=values.themeWidget!==false;
  result.thinking=values.thinking===true;
  result.replyStickers=values.replyStickers!==false;
  result.replyNarration=values.replyNarration===undefined?'scene':values.replyNarration;if(!NARRATION_MODES.some(p=>p.id===result.replyNarration))throw Error('请选择有效的叙事显示方式。');
  if(!['quiet','pattern','sticker'].includes(result.themeDetail))throw Error('请选择有效的主题装饰。');
  if(!['enter','ctrl-enter'].includes(result.sendKey))throw Error('请选择有效的发送快捷键。');
  if(!THEME_IDS.includes(result.theme)||!['small','medium','large'].includes(result.fontScale))throw Error('请选择有效的阅读设置。');
  result.themeChoiceVersion=1;
  result.appScale=normalizeAppScale(values.appScale??100);
  result.density=values.density||'comfortable';if(!['compact','comfortable','airy'].includes(result.density))throw Error('请选择有效的内容间距。');
  result.sceneDockEnabled=values.sceneDockEnabled!==false;result.sceneDockCoins=values.sceneDockCoins!==false;result.sceneDockLocked=values.sceneDockLocked===true;
  result.sceneDockSize=values.sceneDockSize||'standard';if(!['compact','standard','large'].includes(result.sceneDockSize))throw Error('请选择有效的悬浮按钮大小。');
  if(!result.baseUrl&&!result.model)return result;
  if(!result.baseUrl||!result.model)throw Error('请同时填写服务地址和模型名称，或同时留空。');
  let endpoint;try{endpoint=new URL(result.baseUrl);}catch{throw Error('服务地址格式不正确。');}
  if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('服务地址需使用 HTTP/HTTPS，且不能包含密钥、查询参数或账号。');
  if(result.model.length>160||/[\r\n]/.test(result.model))throw Error('请检查模型名称。');
  return result;
}
