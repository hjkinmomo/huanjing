import {boundedWorldPrompt} from './bounded-world-context.mjs?v=time-life-20261017';
export function elapsedLabel(seconds){
 if(seconds===null||seconds===undefined)return '本段聊天的首次联系';
 if(seconds<60)return '不到一分钟';if(seconds<3600)return `${Math.floor(seconds/60)} 分钟`;
 if(seconds<86400)return `${Math.floor(seconds/3600)} 小时`;return `${Math.floor(seconds/86400)} 天`;
}
export function worldLifePrompt(life,channel){
 if(!life?.enabled)return channel==='phone'?'[contact-channel-v1] 当前通过手机远程联系。只发送角色的文字与适当表情，不假设你们面对面，不描写替用户做出的动作；此渠道不改人格或记忆归属。':'';
 return boundedWorldPrompt(life,channel,elapsedLabel(life.elapsedSeconds));
}
export function contactScene(life,previous){
 if(!life?.enabled||!life.valid)return previous;
 return {state:{...(previous?.state||{}),location:life.character.name,setting:previous?.state?.location===life.character.name?previous.state.setting:life.character.description||'',activity:life.character.activity},source:'world-ledger',revision:previous?.revision||0};
}

export function worldStamp(life,real=new Date()){
 const offset=life?.enabled?Date.parse(life.worldUtc)-Date.parse(life.realUtc||life.worldUtc):0;
 return new Date(real.getTime()+(Number.isFinite(offset)?offset:0)).toISOString();
}
