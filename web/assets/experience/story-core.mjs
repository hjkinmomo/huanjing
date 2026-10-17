import {extendEpisodes} from './story-episodes.mjs';
import {applyStoryMedia} from './story-media.mjs';
import {extendChapters,journeyDetails} from './story-chapters.mjs';
export {journeyDetails};
const art=name=>`./assets/experience/media/stories/${name}-v1.png`;
const choice=(id,label,next)=>({id,label,next});
const node=(title,text,image,choices=[])=>({title,text,image,choices});
export const STORY_PACKS={
 shira:{id:'shira-evening',version:1,title:'把夜色慢慢逛完',subtitle:'挑礼物 · 谈品味 · 窗边小憩',motif:'ribbon',nodes:{
  start:node('灯刚亮起来','街道还留着雨后的凉意。橱窗里的暖光把步子放慢了；今晚可以挑件小东西，也可以什么都不买。',art('shopping-street'),[choice('gift','看看橱窗里的礼物','gift'),choice('coffee','先找个地方坐坐','coffee')]),
  gift:node('挑选，不急着买','丝带、陶瓷和纸张摆在木柜台上。你们停在一只酒红缎带礼盒前，话题从“送什么”变成了“什么才像你”。',art('shira-evening-gift'),[choice('meaning','聊聊礼物里的心意','meaning'),choice('taste','看看彼此的品味','taste')]),
  meaning:node('比价格多一点','一份礼物可以只是“路过时想到了你”。比起价格，你更想让收礼物的人记住哪一刻？',art('shira-evening-gift'),[choice('rest','去咖啡店继续聊','coffee')]),
  taste:node('选一件有故事的小物','你们把注意力放到材质与颜色上：喜欢的东西，未必需要立刻拥有。',art('gift-boutique'),[choice('rest','带着想法去喝杯咖啡','coffee')]),
  coffee:node('窗边的位置','窗外的灯接连亮了起来，木桌上留着温暖的一角。在这里，不赶下一站也算一种选择。',art('cafe'),[choice('linger','留一会儿，看街上的灯','end')]),
  end:node('留住这段夜色','橱窗里的丝带、杯沿的热气，还有不急着说完的话。今晚最想留下的，是哪一个细节？',art('shira-evening-gift'))
 }},
 koka:{id:'koka-discovery',version:1,title:'今天发现了一点可爱',subtitle:'甜品橱窗 · 小物发现 · 二选一',motif:'ticket',nodes:{
  start:node('走一条没走过的街','暖灯把橱窗照得像小小的舞台。今天不用规划得很满，选一处让你想停下来的地方就好。',art('shopping-street'),[choice('sweet','先看甜品橱窗','sweet'),choice('trinket','去找一件有趣的小物','trinket')]),
  sweet:node('纸袋里的小惊喜','可卡拿起兔子图案的纸袋，把小焦抱在另一边。橱窗里的点心排成了一小行，挑口味本身就像一场小小的探险。',art('koka-sweet-discovery'),[choice('comfort','熟悉的口味，稳稳的快乐','familiar'),choice('surprise','试试没见过的口味','surprise')]),
  trinket:node('可爱也可以很实用','贴纸、杯子和小本子里，你更想选“好看”还是“每天会用到”？先挑想法，不急着结账。',art('gift-boutique'),[choice('pretty','喜欢它就够了','surprise'),choice('useful','找一个每天能用的小东西','familiar')]),
  familiar:node('今天的小确幸','不是每一次出门都需要冒险。你们为熟悉而舒服的选择留了一个位置。',art('koka-sweet-discovery'),[choice('record','记下今天喜欢的小东西','end')]),
  surprise:node('发现清单，多了一项','一个新的颜色、一种没试过的口味，都能变成下次聊天的话题；没有购买也不会错过剧情。',art('koka-sweet-discovery'),[choice('record','把发现收进手记','end')]),
  end:node('给今天盖个小小的章','今天的发现清单里，多了一个新颜色、一种口味，还是一件让你忍不住笑的小东西？写一句就好。',art('koka-sweet-discovery'))
 }},
 shuyun:{id:'shuyun-pages',version:1,title:'一页书，一段街景',subtitle:'书店漫游 · 观察采风 · 接句游戏',motif:'page',nodes:{
  start:node('从一扇书店的窗开始','天色渐蓝，书脊上的灯光仍然温暖。你可以先翻一页书，也可以沿着窗外的街道找一个细节。',art('bookshop'),[choice('read','在书店停一会儿','read'),choice('observe','从街景里找一个细节','observe')]),
  read:node('翻到没有折角的一页','书韵把书摊开，留出一个可以一起观察的位置。窗外的街景刚好停在页边，像一段还没写完的开头。',art('shuyun-bookshop-note'),[choice('sentence','玩一次接句：窗外的灯亮了……','sentence'),choice('detail','聊聊书页与生活里的细节','detail')]),
  observe:node('采风，不一定走很远','橱窗倒影、湿石板和快要熄灭的天光。选一个细节，想想它会出现在怎样的故事里。',art('shopping-street'),[choice('reflection','选窗上的倒影','detail'),choice('light','选最后一线天光','sentence')]),
  sentence:node('把句子留给你','“窗外的灯亮了，而……” 后半句由你决定。可以在纪念卡写下来，再带回聊天邀请书韵续写。',art('shuyun-bookshop-note'),[choice('note','留下我的半句话','end')]),
  detail:node('看见，然后再解释','同一个细节可以有两种读法。倒影是另一条街道，还是被玻璃留住的一瞬？先写下你看见的东西。',art('shuyun-bookshop-note'),[choice('note','给这个细节写一句话','end')]),
  end:node('一页只属于这段散步的笔记','一个观察、半句话，或一个问题。纸页还有空白，不必急着给这段散步一个结论。',art('shuyun-bookshop-note'))
 }},
 generic:{id:'shared-stroll',version:1,title:'一起去街角走走',subtitle:'自由散步 · 看看橱窗 · 随时聊聊',motif:'page',nodes:{
  start:node('街角的邀请','选一处想停留的地方。这条路线不预设角色性格，之后的交流使用你保存的人格设定。',art('shopping-street'),[choice('book','去书店看看','book'),choice('cafe','在咖啡店坐坐','cafe')]),
  book:node('一起翻一页','你可以观察一本书的封面，或带来自己想聊的作品。这里没有自动替角色写下的固定回复。',art('bookshop'),[choice('keep','留下一个想聊的话题','end')]),
  cafe:node('不赶时间的一站','停在窗边，留一点时间给想说的话。',art('cafe'),[choice('keep','记下此刻的想法','end')]),
  end:node('散步可以继续到聊天里','留下一个问题或一句感想，再邀请当前角色继续聊。',art('shopping-street'))
 }}
};
extendChapters(STORY_PACKS);
extendEpisodes(STORY_PACKS);
applyStoryMedia(STORY_PACKS);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const safeRole=id=>typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
export function packFor(roleId){return Object.hasOwn(STORY_PACKS,roleId)?STORY_PACKS[roleId]:STORY_PACKS.generic;}
export function sceneFor(session,pack){
 const scene=pack.nodes[session.node],details=journeyDetails(session,pack);
 if(session.node==='end'&&details.extended)return {...scene,title:details.outcomes.join(' · ')||scene.title,text:pack.nodes['long-reflection'].text,image:pack.nodes['long-reflection'].image};
 return scene;
}
export function readStories(state){
 if(state.stories===undefined||object(state.stories)&&Object.keys(state.stories).length===0)return {schema:1,sessions:{},cards:[]};
 const s=state.stories;
 // Earlier whole-game resets retained cards/sessions but omitted this envelope.
 // Read that exact legacy shape without mutating or discarding its contents.
 if(object(s)&&s.schema===undefined&&object(s.sessions)&&Array.isArray(s.cards))return {...s,schema:1};
 if(!object(s)||s.schema!==1||!object(s.sessions)||!Array.isArray(s.cards))throw Error('同行手记格式无法读取，原资料未改动。');
 return s;
}
export function validateSession(session,roleId){
 const pack=packFor(roleId);
 if(!safeRole(roleId)||!object(session)||session.roleId!==roleId||session.packId!==pack.id||session.version!==pack.version||typeof session.id!=='string'||!session.id||!Number.isSafeInteger(session.revision)||session.revision<0||!Array.isArray(session.trail)||session.trail.length>48||typeof session.note!=='string'||session.note.length>800)throw Error('这段旅程的版本或资料有变化，未覆盖进度。');
 let at='start';
 for(const step of session.trail){const next=pack.nodes[at].choices.find(c=>c.id===step?.choiceId);if(step?.node!==at||!next)throw Error('路线记录不完整，原进度已保留。');at=next.next;}
 if(at!==session.node)throw Error('场景与路线记录不一致。');
 return session;
}
export function newSession(roleId,id){
 if(!safeRole(roleId)||typeof id!=='string'||!id)throw Error('角色或旅程编号无效。');
 const pack=packFor(roleId);return {id,roleId,packId:pack.id,version:pack.version,node:'start',trail:[],revision:0,note:''};
}
export function choose(session,roleId,choiceId){
 validateSession(session,roleId);const pack=packFor(roleId),selected=pack.nodes[session.node].choices.find(c=>c.id===choiceId);
 if(!selected)throw Error('这个选择已不属于当前场景。');
 return {...session,node:selected.next,trail:[...session.trail,{node:session.node,choiceId}],revision:session.revision+1};
}
export function rewind(session,roleId){validateSession(session,roleId);if(!session.trail.length)return session;const trail=session.trail.slice(0,-1);return {...session,node:session.trail.at(-1).node,trail,revision:session.revision+1};}
export function updateStory(state,roleId,expected,transform){
 const source=readStories(state),current=Object.hasOwn(source.sessions,roleId)?source.sessions[roleId]:null;
 if(JSON.stringify(current)!==JSON.stringify(expected))throw Error('旅程已在其他窗口变化，请重新打开同行页面。');
 const next=transform(current);validateSession(next,roleId);
 state.stories={...source,sessions:{...source.sessions,[roleId]:next}};return next;
}
export function recordCard(state,roleId,expected,at){
 const source=readStories(state),current=Object.hasOwn(source.sessions,roleId)?source.sessions[roleId]:null;
 if(JSON.stringify(current)!==JSON.stringify(expected))throw Error('旅程已变化，请重新打开后保存。');
 validateSession(current,roleId);const pack=packFor(roleId);
 if(pack.nodes[current.node].choices.length)throw Error('完成这段路线后再留下纪念卡。');
 if(source.cards.some(c=>c.id===current.id))return false;
 if(source.cards.length>=100)throw Error('手记已满，现有纪念卡保留，未覆盖。');
 const details=journeyDetails(current,pack);
 const card={id:current.id,roleId,packId:pack.id,version:pack.version,title:pack.nodes[current.node].episodeTitle||pack.title,node:current.node,image:sceneFor(current,pack).image,note:current.note,trail:structuredClone(current.trail),outcomes:details.outcomes,at,source:'story',fiction:true,visibility:'local'};
 state.stories={...source,cards:[card,...source.cards]};return true;
}
export function storyPrompt(session,roleId){
 validateSession(session,roleId);const pack=packFor(roleId),path=session.trail.map(s=>pack.nodes[s.node].choices.find(c=>c.id===s.choiceId).label).join(' → ');
 const note=session.note?`我的感想或半句话：${session.note}${/[。！？.!?]$/.test(session.note)?'':'。'}`:'';
 return `想和你聊一段虚构的同行场景「${pack.nodes[session.node].episodeTitle||pack.title}」。目前到「${pack.nodes[session.node].title}」，我的选择是：${path||'刚开始'}。${note}请按你保存的人格自然回应，可以追问我的看法。这是角色扮演场景，不是现实经历；没有发生实际购买或赠礼。`;
}
