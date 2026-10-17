// A location is independent of a character. A story selects a location and an
// action; art packs may additionally restrict a genuinely private location.
const asset=path=>new URL(`./media/story-library-v3/${path}`,import.meta.url).href;
const location=(id,title,objects=[])=>Object.freeze({id,title,image:asset(`backgrounds/${id}.webp`),allowedRoles:null,objects:Object.freeze(objects)});
const item=(id,title,x,y,detail)=>Object.freeze({id,title,x,y,detail});
const DAY_BACKGROUNDS=[
 location('street','晴日街角',[item('bench','街边长椅',.23,.66,'木条边缘有细小的使用痕迹。散步时，也可以在这里歇一会儿。')]),
 location('street-night','夜晚街角',[item('bench','街边长椅',.23,.66,'长椅仍留在白天的位置。店铺的灯亮了，石板上留着雨后的反光。')]),
 location('boutique','小物店',[item('parcel','柜台的小礼盒',.25,.53,'纸盒用一条普通缎带收好。这里只是看见剧情里的陈设，不会发生实际购买。')]),
 location('cafe','窗边咖啡馆',[item('cup','桌上的杯子',.28,.63,'温热的杯子放在托碟中，桌上还留着可以摆一本书的位置。')]),
 location('cafe-night','夜间咖啡馆',[item('cup','桌上的杯子',.28,.63,'灯下的杯口升起一点热气。窗外街灯亮起，店内的声音也慢了下来。')]),
 location('bookshop','安静书店',[item('book','桌边的书',.25,.63,'书页没有被写满。这里的观察只属于虚构场景，不会归入现实记忆。')]),
 location('conservatory','玻璃花房',[item('plant','窗边的绿叶',.2,.58,'叶片向窗外的光伸去。光线很柔和，可以看见叶脉，而不是满墙装饰。')]),
 location('piano-room','小琴房',[item('score','琴谱与信封',.23,.53,'琴谱可以翻看，封好的信仍留在原处。每一件东西都有自己的边界。')]),
 location('rain-porch','雨后门廊',[item('umbrella','收起的伞',.27,.65,'伞边留着一点雨水。门廊给它和今晚的谈话都留出了干燥的位置。')]),
 location('lantern-stall','手作灯摊',[item('lantern','纸兔子灯',.23,.56,'纸纤维透出一点柔光，一只耳朵的旧折痕还在。它是可观察的陈设，不自动加入背包。')]),
 location('lantern-path','山坡小路',[item('star','树下的纸星星',.21,.35,'纸角不全相同。走近看，手作留下的痕迹也很有意思。')]),
 location('lantern-overlook','夜间观景台',[item('lights','远处的灯',.38,.45,'镇上的窗户并非同时亮起。留在这里等一会儿，夜色也会慢慢变化。')]),
 location('station-reading','旧站阅览室',[item('manuscript','桌上的影印页',.23,.62,'可以观察影印页；原稿的结尾仍然留白。自己的续写需要另用一张纸。')]),
 location('old-platform','雨夜旧站台',[item('clock','停下来的站钟',.23,.28,'钟停在过去的某一刻。仅凭钟面，不能推断这里发生过什么。')])
];
const NIGHT_TITLES={'boutique':'夜间小物店','bookshop':'灯下书店','conservatory':'雨夜花房','piano-room':'夜间琴房','station-reading':'旧站夜间阅览室'};
export const STORY_BACKGROUNDS=Object.freeze([...DAY_BACKGROUNDS,...DAY_BACKGROUNDS.filter(b=>NIGHT_TITLES[b.id]).map(b=>Object.freeze({...b,id:b.id+'-night',title:NIGHT_TITLES[b.id],image:asset('backgrounds/'+b.id+'-night.webp')}))]);
const pose=(role,id,title)=>Object.freeze({id,title,image:asset(`characters/${role}/${id}.png`)});
const cardPose=(role,id,title,art)=>Object.freeze({id,title,image:new URL('./role-card/collection/'+art+'/subject.png',import.meta.url).href});
export const STORY_POSES=Object.freeze({
 shira:Object.freeze([Object.freeze({id:'talk',title:'自然交谈',image:new URL('./role-card/collection/poses/shira-talk.png',import.meta.url).href}),cardPose('shira','star-chair','托腮小憩','shira_v5_stars'),pose('shira','tea','经典 · 捧杯小憩'),cardPose('shira','beach','海风小憩','shira_v5_lounger')]),
 koka:Object.freeze([pose('koka','talk','轻快交谈'),cardPose('koka','star-chair','坐下提灯','koka_v5_stars'),cardPose('koka','orbit','星环拾光','koka_v5_orbit'),Object.freeze({...pose('koka','lantern','提灯观察'),nightImage:new URL('./media/card-scenes-v4/characters/koka-lantern-night.png',import.meta.url).href})]),
 shuyun:Object.freeze([pose('shuyun','talk','手记交谈'),cardPose('shuyun','read','翻页阅读','shuyun_v5_library'),cardPose('shuyun','desk','托腮伏案','shuyun_v5_desk')])
});
export function availableBackgrounds(roleId,entries=STORY_BACKGROUNDS){return entries.filter(scene=>!scene.allowedRoles||scene.allowedRoles.includes(roleId));}
export function backgroundFor(id,roleId){return availableBackgrounds(roleId).find(scene=>scene.id===id)||STORY_BACKGROUNDS[0];}
function locationFor(role,node){
 if(node.startsWith('extra-')){
  const key=node.slice(6);
  if(role==='shira')return ['porch','return','end-note','end-rain'].includes(key)?'rain-porch':key==='invite'?'conservatory':['tea','talk','watch'].includes(key)?'cafe':'piano-room';
  if(role==='koka')return ['invite','stall','star','repair','plain','knot','end-song','end-light'].includes(key)?'lantern-stall':['fork','steps','trees'].includes(key)?'lantern-path':'lantern-overlook';
  if(role==='shuyun')return key==='platform'?'old-platform':key==='invite'?'bookshop':'station-reading';
 }
 const key=node.replace(/^long-/,'');
 if(role==='shuyun'&&node==='start')return 'bookshop';
 if(['start','invite','boulevard','lane','outside','observe'].includes(key))return 'street';
 if(['gift','meaning','taste','trinket','shop','practical','special','carry','taken','wish'].includes(key))return 'boutique';
 if(role==='shuyun'&&['read','sentence','detail','end'].includes(key)||role==='generic'&&key==='book')return 'bookshop';
 return 'cafe';
}
function defaultPose(role,scene,session){
 if(role==='shira')return scene.backgroundId.startsWith('cafe')&&['extra-tea','extra-talk','extra-watch'].includes(session?.node)?'star-chair':'talk';
 if(role==='shuyun'&&['extra-draft','extra-readback','extra-end-page'].includes(session?.node))return 'desk';
 if(role==='shuyun')return ['bookshop','station-reading'].some(id=>scene.backgroundId.startsWith(id))&&!['extra-draft','extra-leave','extra-stay','extra-readback','extra-end-page','extra-end-open'].includes(session?.node)?'read':'talk';
 if(role==='koka'&&session?.node?.startsWith('extra-')&&(session.node==='extra-knot'||session.trail?.some(step=>step.node==='extra-knot'))&&!session.trail?.some(step=>step.node==='extra-plain'))return 'lantern';
 return 'talk';
}
export function scenePresentation(roleId,scene,session,overrides={}){
 const background=backgroundFor(overrides.background||scene.backgroundId,roleId);
 const poses=STORY_POSES[roleId]||[];
 const selected=poses.find(p=>p.id===overrides.pose)||poses.find(p=>p.id===defaultPose(roleId,{...scene,backgroundId:background.id},session))||null;
 const night=background.id.includes('night')||background.id.startsWith('lantern')||background.id==='old-platform';
 return {background,pose:selected?.nightImage&&night?{...selected,image:selected.nightImage}:selected,side:overrides.side==='left'?'left':'right'};
}
export function applyStoryMedia(packs){
 for(const [role,pack]of Object.entries(packs))for(const [id,node]of Object.entries(pack.nodes)){
  let backgroundId=locationFor(role,id);
  const episode=pack.nodes[id.startsWith('extra-')?'extra-invite':id.startsWith('long-')?'long-invite':'start'];
  const text=node.text+' '+node.title,context=episode?.text||'';
  const night=node.timeOfDay==='night'||(node.timeOfDay!=='day'&&!/白天|清晨|午后|上午|日光/.test(text)&&/夜|晚|暮|天色渐蓝|暖灯|灯已经亮|快打烊/.test(text+' '+context));
  if(night&&['street','cafe',...Object.keys(NIGHT_TITLES)].includes(backgroundId))backgroundId+='-night';
  node.backgroundId=backgroundId;node.image=backgroundFor(backgroundId,role).image;
 }
}
export function resolveStoryAsset(source){
 if(typeof source!=='string')return STORY_BACKGROUNDS[0].image;
 return new URL(source.replace(/^\.\/assets\/experience\//,'./'),import.meta.url).href;
}
