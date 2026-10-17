export const MUSIC_TRACKS=Object.freeze([
 {id:'vaporware',title:'静谧云境',artist:'The Cynic Project / cynicmusic',mood:'安静 · 钢琴与氛围',src:'./assets/experience/music/vaporware.mp3',source:'https://opengameart.org/content/calm-piano-1-vaporware'},
 {id:'happy-moments',title:'晴日片刻',artist:'Centurion_of_war',mood:'温暖 · 轻快钢琴',src:'./assets/experience/music/happy-moments.ogg',source:'https://opengameart.org/content/happy-moments'},
 {id:'forget-me-not',title:'勿忘我',artist:'Kistol',mood:'温柔 · 怀旧钢琴',src:'./assets/experience/music/forget-me-not.ogg',source:'https://opengameart.org/content/forget-me-not'},
 {id:'bright-eyes',title:'明亮眼眸',artist:'tomcat',mood:'轻快 · 钢琴与长笛',src:'./assets/experience/music/bright-eyes.ogg',source:'https://opengameart.org/content/bright-eyes'},
].map(t=>Object.freeze({...t,license:'CC0-1.0'})));
export const recommendedMusic=roleId=>roleId==='koka'?'bright-eyes':roleId==='shuyun'?'vaporware':'forget-me-not';
