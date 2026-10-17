import {APPEARANCE_FIELDS,MODEL_FIELDS,ROLE_SETTING_FIELDS,settingsDraft,validatedAppearance,validatedModelSettings,validatedRoleSettings} from './settings-validation.mjs';
import {normalizeReplyStyle} from './reply-style.mjs';
import {normalizeNarration} from './chat-presentation.mjs';
import {DEFAULT_CONTEXT_WINDOW} from './token-budget.mjs';
import {themeChoice,setGlobalTheme} from './themes.mjs?v=stage-background-20261011';

export function settingsFormValues(appearance,settings,draft={}){
  const pending=Object.fromEntries([...MODEL_FIELDS,...ROLE_SETTING_FIELDS].filter(key=>Object.hasOwn(draft,key)).map(key=>[key,draft[key]]));
  const current=Object.fromEntries(APPEARANCE_FIELDS.filter(key=>Object.hasOwn(appearance,key)).map(key=>[key,appearance[key]]));
  const result={appScale:100,replyStyle:'natural',fontScale:'medium',sendKey:'enter',themeDetail:'pattern',themeWidget:true,reducedMotion:false,sceneDockEnabled:true,sceneDockCoins:true,sceneDockLocked:false,sceneDockSize:'standard',memoryContext:false,roleSkills:true,replyStickers:true,contextCompression:true,contextBudget:24000,contextWindow:DEFAULT_CONTEXT_WINDOW,...settings,...pending,...current,theme:themeChoice(appearance)};
  result.replyStyle=normalizeReplyStyle(result.replyStyle);result.replyNarration=normalizeNarration(result.replyNarration);return result;
}

export function mountSettings(form,{values,fill,readAppearance,readSettings,readDraft,mutate,apply,getRoleId,privateAgent=false}){
  const feedback=form.querySelector('#settings-feedback'),saveButton=form.querySelector('[type=submit]');
  let section='reading';
  function commit(next,keys){
    mutate(state=>{
      const globalNext={...next};
      if(Object.hasOwn(next,'theme')){setGlobalTheme(state,next.theme);delete globalNext.theme;delete globalNext.themeChoiceVersion;}
      if(privateAgent){state.agentSettings||={};const id=getRoleId();state.agentSettings[id]||={};for(const key of [...MODEL_FIELDS,...ROLE_SETTING_FIELDS])if(Object.hasOwn(globalNext,key)){state.agentSettings[id][key]=globalNext[key];delete globalNext[key];}}
      state.settings={...state.settings,...globalNext};
      const draft=privateAgent?state.agentSettingsDrafts?.[getRoleId()]:state.settingsDraft;
      if(draft)for(const key of keys)delete draft[key];
    });
    apply({appearanceOnly:keys.every(key=>APPEARANCE_FIELDS.includes(key))});
  }
  function keepDraft(){
    const next=settingsDraft(values(form));
    for(const key of APPEARANCE_FIELDS)delete next[key];
    mutate(state=>{if(privateAgent){state.agentSettingsDrafts||={};state.agentSettingsDrafts[getRoleId()]=next;}else state.settingsDraft=next;});
    feedback.textContent=section==='connection'?'模型修改尚未保存。保存配置或验证成功后，聊天才会使用它。':'修改已保留，请保存相处设置。';
  }
  const appearancePanel=target=>!!target.closest('[data-preference-panel="reading"],[data-preference-panel="appearance"]');
  form.addEventListener('input',event=>{if(!appearancePanel(event.target))try{keepDraft();}catch(error){feedback.textContent=`草稿未保存：${error.message}`;}});
  form.addEventListener('change',event=>{
    if(!appearancePanel(event.target))return;
    try{const validated=validatedAppearance(values(form)),name=event.target.name;if(!APPEARANCE_FIELDS.includes(name))return;const keys=name==='theme'?['theme','themeChoiceVersion']:[name];commit(Object.fromEntries(keys.map(key=>[key,validated[key]])),keys);feedback.textContent='外观已自动保存，聊天文字和输入框同步生效。';}
    catch(error){feedback.textContent=`外观未保存：${error.message}`;}
  });
  function saveModel(next){commit(validatedModelSettings(next),MODEL_FIELDS);feedback.textContent='模型配置已保存。';}
  form.onsubmit=event=>{
    event.preventDefault();
    try{
      const next=values(form);
      if(section==='connection')saveModel(next);
      else if(['role','memory'].includes(section)){commit(validatedRoleSettings(next),ROLE_SETTING_FIELDS);feedback.textContent='相处设置已保存，新的回复习惯从下次发送生效。';}
      else{commit(validatedAppearance(next),APPEARANCE_FIELDS);feedback.textContent='外观已自动保存。';}
    }catch(error){feedback.textContent=`未保存：${error.message}`;}
  };
  function select(next){section=next;saveButton.hidden=['reading','appearance'].includes(next);saveButton.textContent=next==='connection'?'保存模型配置':'保存相处设置';feedback.textContent=next==='reading'?'外观调整立即生效并自动保存。':next==='connection'?'模型配置需要保存；验证成功会保存本次配置。':'记忆与回复习惯修改后，请保存相处设置。';}
  return {fill(){fill(form,settingsFormValues(readAppearance(),readSettings(),readDraft()||{}));const out=form.querySelector('[data-scale-value]');if(out)out.textContent=form.elements.appScale.value+'%';},select,keepDraft,saveModel};
}
