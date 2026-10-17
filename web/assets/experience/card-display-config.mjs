// One catalog for the editor, WebGL renderer and lightweight fallback.
export const CARD_MATERIALS=Object.freeze([
 {id:'pearl',label:'珠光',code:0},{id:'silver',label:'银箔',code:1},
 {id:'original',label:'原画',code:2},{id:'gold',label:'烫金',code:3},
 {id:'glitter',label:'闪光卡',code:4},{id:'iridescent',label:'炫彩卡',code:5}
]);
export const CARD_DISPLAYS=Object.freeze([
 {id:'none',label:'无卡面',description:'保留原来的悬浮名字，不加展示边框。'},
 {id:'moon-silver',label:'月银花枝',description:'月石银花、疏落的银饰碎片与独立珐琅名字牌。',ink:'#edf5ff',accent:'#b7d9e8',asset:'moon-silver-v3.png',nameAt:[.50,.93],nameBox:[.19,.867,.79,.99],corner:[[0,0],[.61,0],[.61,.25],[.30,.34],[.18,.415],[.095,.415],[.095,.35],[0,.35]]},
 {id:'rose-gold',label:'暗金玫瑰',description:'暗红玫瑰、旧金藤饰与独立深色名字牌。',ink:'#fff1d7',accent:'#c5a172',asset:'rose-gold-v3.png',nameAt:[.50,.915],nameBox:[.20,.83,.81,.975],corner:[[.36,0],[1,0],[1,.414],[.84,.414],[.69,.28],[.36,.12]]},
 {id:'pearl-ribbon',label:'珍珠缎带',description:'柔粉丝缎、错落珍珠与独立瓷白名字牌。',ink:'#6d4560',accent:'#d6b8c4',asset:'pearl-ribbon-v3.png',nameAt:[.50,.89],nameBox:[.235,.80,.77,.995],corner:[[0,0],[.48,0],[.48,.145],[.26,.255],[.24,.505],[0,.53]]}
]);
export const DISPLAY_DEPTH=.90;
// The trim overlaps the print rim; the independent name plaque keeps its registration.
export const DISPLAY_EDGE_SCALE=1.08;
export function displayEdgeUV(value){const v=Math.max(0,Math.min(1,value)),t=Math.min(1,Math.min(v,1-v)/.25),fade=1-t*t*(3-2*t);return Math.max(-.018,Math.min(1.018,v+(v<.5?-1:1)*.064*fade));}
export function normalizeCardDisplay(id){return CARD_DISPLAYS.some(p=>p.id===id)?id:'none';}
export function cardDisplayAsset(id){const value=normalizeCardDisplay(id);return value==='none'?'':`/assets/experience/role-card/display-assets/${CARD_DISPLAYS.find(p=>p.id===value).asset}`;}
export function selectedCardDisplay(state,role){return normalizeCardDisplay(state.display?.[role.id]?.cardDisplay);}
export function changeCardDisplay(state,role,id){
 if(!CARD_DISPLAYS.some(p=>p.id===id))throw Error('卡面选项无效。');
 state.display||={};state.display[role.id]={...state.display[role.id],cardDisplay:id};
}
