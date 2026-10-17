const image=id=>`./assets/experience/media/story-objects-v1/${id}.png`;
const objects={
 letter:{title:'未拆开的信',image:image('letter'),materials:'纸张 · 蜡封 · 缎带',detail:'厚纸边缘留下了细小磨痕，酒红蜡封仍然完整。这里展示信封与桌边的笔，不会替故事里的人拆开它。'},
 lantern:{title:'歪耳朵的兔子灯',image:image('lantern'),materials:'竹篾 · 纸纤维 · 暖光',detail:'暖光透过纸纤维。耳朵的旧折痕还在，粉色纸绳给它留了一点活动的余量。修补后的样子也可以被喜欢。'},
 notebook:{title:'蓝笺与银笔',image:image('notebook'),materials:'布面 · 银笔 · 叶脉',detail:'蓝色布面包着纸页，书签垂在页边。银笔和压平的叶片是书韵的随身小物；空白留给自己的试写，不属于匿名手稿。'}
};
export function objectFor(role,session){
 if(!session?.node?.startsWith('extra-'))return null;
 const key=session.node.slice(6),visited=id=>session.trail?.some(s=>s.node===`extra-${id}`);
 if(role==='shira'&&['door','ask','score','tune','quiet','soft','tea','talk','watch'].includes(key))return objects.letter;
 if(role==='koka'&&(key==='knot'||visited('knot'))&&!visited('plain')&&key!=='end-song')return objects.lantern;
 if(role==='shuyun'&&['draft','leave','stay','readback','end-page','end-open'].includes(key))return objects.notebook;
 return null;
}
export function stagePortrait(role,scene){
 if(!scene?.image?.includes('/theater-v1/'))return '';
 const id={shira:'shira_identity',koka:'koka_casual',shuyun:'shuyun_work'}[role];
 return id?`./assets/experience/role-card/collection/${id}/subject.png`:'';
}
