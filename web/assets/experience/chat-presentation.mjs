import baseline from './chat-presentation.json' with {type:'json'};
import defaults from './runtime-defaults.json' with {type:'json'};
export let presentationPolicy={...structuredClone(baseline),...structuredClone(defaults)};
export let NARRATION_MODES=Object.freeze(presentationPolicy.narrationModes.map(p=>Object.freeze({...p})));
export function setPresentationPolicy(value){
 if(!value?.narrationModes||!value?.reveal||typeof value.reasoningLanguagePrompt!=='string')throw Error('旁白配置格式无效。');
 presentationPolicy=structuredClone(value);NARRATION_MODES=Object.freeze(presentationPolicy.narrationModes.map(p=>Object.freeze({...p})));
}
export function normalizeNarration(value){return NARRATION_MODES.some(p=>p.id===value)?value:'scene';}
export function narrationPrompt(value){const mode=NARRATION_MODES.find(p=>p.id===normalizeNarration(value));return ['可更改的叙事显示习惯：'+mode.label+'。'+mode.guidance,...(mode.id==='off'?[]:presentationPolicy.narrationRules)].join('\n');}
