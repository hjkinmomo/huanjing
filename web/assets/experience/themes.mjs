export const THEME_IDS=Object.freeze(['light','dark','system','character','night','day','shira-velvet','koka-day','koka-night','shuyun-day','shuyun-night','package']);
// Warm daylight is the neutral default; explicit character choices stay opt-in.
const LIGHT={bg:'#faf6f0',surface:'#fffdf9',raised:'#f1e7dc',ink:'#392f2b',muted:'#6f5e55',line:'#d8c9bc',accent:'#875642',button:'#80503c','button-ink':'#ffffff',bubble:'#f3e4d7'};
const DARK={bg:'#1d2221',surface:'#272e2c',raised:'#35403b',ink:'#edf1ef',muted:'#b5c2bc',line:'#52615a',accent:'#a9cabb',button:'#b9d6c7','button-ink':'#21352c',bubble:'#2e3b35'};
const ROSE={bg:'#f4ecef',surface:'#fbf5f6',raised:'#e9dbe2',ink:'#392c38',muted:'#725c6c',line:'#d8c4cf',accent:'#874a65',button:'#79465f','button-ink':'#fcf0f4',bubble:'#e9dbe2'};
const PLUM={bg:'#1c141c',surface:'#291d27',raised:'#3b2735',ink:'#f4e8ee',muted:'#c6acbc',line:'#513543',accent:'#d697ae',button:'#e6b7c3','button-ink':'#39222f',bubble:'#382330'};
const KOKA={bg:'#faf5ed',surface:'#fffcf7',raised:'#f0e4d3',ink:'#3e322a',muted:'#715e50',line:'#d7c5af',accent:'#825331',button:'#825331','button-ink':'#ffffff',bubble:'#f0e4d3'};
const SHUYUN={bg:'#eef3f7',surface:'#f9fcff',raised:'#dce7ef',ink:'#233a4d',muted:'#50667a',line:'#bccbd8',accent:'#355f80',button:'#355f80','button-ink':'#ffffff',bubble:'#dce7ef'};
const VELVET={...PLUM,bg:'#211c2c',surface:'#2c2538',raised:'#3b324a',line:'#61526c',accent:'#d5b2d1',button:'#d9bdd4',bubble:'#392f47'};
const KOKA_NIGHT={bg:'#25212b',surface:'#302b37',raised:'#403647',ink:'#f6eced',muted:'#ccbbc8',line:'#675665',accent:'#e8b8c8',button:'#edc6d0','button-ink':'#39242d',bubble:'#453441'};
const SHUYUN_NIGHT={bg:'#17232e',surface:'#21313f',raised:'#2c4152',ink:'#e6f1f8',muted:'#b1c8d9',line:'#486376',accent:'#a5cadd',button:'#a5cadd','button-ink':'#203441',bubble:'#2b4355'};
export const CHARACTER_THEMES=Object.freeze([
 {id:'night',label:'希拉 · 莓色夜间'},{id:'day',label:'希拉 · 玫瑰日间'},{id:'shira-velvet',label:'希拉 · 紫绒密语'},
 {id:'koka-day',label:'可卡 · 奶油手帐'},{id:'koka-night',label:'可卡 · 草莓晚灯'},
 {id:'shuyun-day',label:'书韵 · 蓝笺午后'},{id:'shuyun-night',label:'书韵 · 墨色夜读'}
]);
export function roleAppearance(global,state,roleId){
 // Explicit application-wide selection wins over earlier role-only preferences.
 if(global?.themeScope==='global'&&THEME_IDS.includes(global.theme))return global;
 const theme=state?.display?.[roleId]?.theme;
 return THEME_IDS.includes(theme)?{...global,theme,themeChoiceVersion:1}:global;
}
export function setGlobalTheme(state,theme){
 if(!THEME_IDS.includes(theme))throw Error('主题无效。');
 state.settings={...state.settings,theme,themeChoiceVersion:1,themeScope:'global'};
}
export function setRoleTheme(state,roleId,theme){
 if(!/^[A-Za-z0-9_.:-]{1,80}$/.test(roleId)||['__proto__','constructor','prototype'].includes(roleId)||!THEME_IDS.includes(theme))throw Error('角色主题无效。');
 state.display||={};state.display[roleId]={...state.display[roleId],theme};
}
export function themeChoice(pref={}){
  // Old automatic character coloration is not evidence of a deliberate choice.
  if(pref.theme==='character'&&pref.themeChoiceVersion!==1)return 'light';
  return THEME_IDS.includes(pref.theme)?pref.theme:'light';
}
export function resolveTheme(pref={},role={},platform={},systemDark=false){
  role={...role,id:role.baseRoleId||role.id};
  const choice=themeChoice(pref);
  let scheme=choice==='dark'||choice==='night'||choice==='character'||(choice==='system'&&systemDark)?'dark':'light';
  let tokens={...(choice==='day'?ROSE:choice==='night'||choice==='character'?PLUM:scheme==='dark'?DARK:LIGHT)};
  if(choice==='character'){
    if(role.id==='koka'||role.id==='shuyun'){tokens={...(role.id==='koka'?KOKA:SHUYUN)};scheme='light';}
    const accent={rikka:'#bcb1da',rem:'#a6c7d7'}[role.id];
    if(accent)tokens.accent=tokens.button=accent;
  }
  if(choice==='package'){
    const pkg=platform?.packages?.find(p=>p.id===platform.activeTheme&&p.type==='theme'&&p.enabled);
    const mapping={'--paper':'bg','--panel':'surface','--ink':'ink','--muted':'muted','--line':'line','--wine':'accent'};
    for(const [key,next] of Object.entries(mapping))if(/^#[0-9a-f]{6}$/i.test(pkg?.themeTokens?.[key]||''))tokens[next]=pkg.themeTokens[key];
    const luminance=hex=>{const c=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
    scheme=luminance(tokens.bg)<.25?'dark':'light';
    const base=scheme==='dark'?DARK:LIGHT;
    for(const key of ['raised','button','button-ink','bubble'])tokens[key]=base[key];
  }
  const presets={'shira-velvet':[VELVET,'dark','shira'],'koka-day':[KOKA,'light','koka'],'koka-night':[KOKA_NIGHT,'dark','koka'],'shuyun-day':[SHUYUN,'light','shuyun'],'shuyun-night':[SHUYUN_NIGHT,'dark','shuyun']};
  let motif=choice==='night'||choice==='day'?'shira':choice==='character'&&['shira','koka','shuyun'].includes(role.id)?role.id:'none';
  if(presets[choice]){tokens={...presets[choice][0]};scheme=presets[choice][1];motif=presets[choice][2];}
  return {choice,scheme,tokens,motif,character:choice==='character'||CHARACTER_THEMES.some(t=>t.id===choice)};
}
