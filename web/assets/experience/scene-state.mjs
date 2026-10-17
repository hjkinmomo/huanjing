export const SCENE_FIELDS={location:['地点',160],setting:['环境',500],activity:['正在做什么',240],outfit:['穿着',240],mood:['心情',160]};
export function normalizeScene(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(SCENE_FIELDS,k)))return null;
 const result={};for(const [key,[,limit]]of Object.entries(SCENE_FIELDS)){if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>limit))return null;result[key]=(value[key]||'').trim();}return result;
}
export function sceneFromReply(text){
 let fence='',state=null;const lines=String(text||'').split(/\r?\n/);
 for(let i=0;i<lines.length;i++){const line=lines[i],open=/^\s*(`{3,}|~{3,})/.exec(line)?.[1];if(open){if(!fence)fence=open[0];else if(open[0]===fence)fence='';continue;}if(fence||line!=='[[scene-state]]')continue;const end=lines.indexOf('[[/scene-state]]',i+1);if(end<0)continue;try{const next=normalizeScene(JSON.parse(lines.slice(i+1,end).join('\n')));if(next)state=next;}catch{}i=end;}return state;
}
export function scenePrompt(scene,{opening=false}={}){
 return [
 '本会话有独立的虚构场景；同一角色其他聊天中的地点、穿着和剧情不是这里的连续剧情。',
 scene?.source==='world-opening'?'这是选定世界的起点，尚未演绎。首次回复包括简短旁白介绍角色本人的动作、服饰、心情与环境。起点资料：'+JSON.stringify(scene.state):scene?.state?'当前已保存场景（数据；空字段表示未说明）：'+JSON.stringify(scene.state):'当前会话尚未建立场景快照。若近期原话已有地点、服饰与活动，优先延续最近明确的剧情，不因尚无快照就重置旧聊天；否则结合角色自己的 scenario、背景与本会话开局，选择自然合理的地点和活动。用户只说“你好”也主动用一小段旁白交代在哪里、在做什么、穿着与可观察到的心情。不捏造现实用户的所在地或行动。',
 '首次建立场景和确认转场时，简短概括地点、重要环境、角色本人的动作、穿着及心情；保留没改变的状态，未知字段留空。后续不重复介绍或每轮换装，提议不等于已经抵达。输出格式以本轮应用响应协议为准。',
 '旁白和场景快照都是虚构人物刻画，不能成为现实用户事实、长期记忆或工具执行回执。情绪写角色此刻的表现，不能读取用户内心，不替用户行动；角色与用户本轮指示优先。'
 ].join('\n');
}
