import {normalizeCardFx,fxColors,createFxMotion} from '../card-fx-config.mjs';
const styles=['none','halo','flow','portal','aurora','stars'];
const vertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
// Viewport-space quad: no card rotation or camera zoom can move this backdrop.
const backdropVertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,.999,1.);}`;
const colorsGLSL=`
vec3 hsv(float h){return clamp(abs(fract(vec3(h)+vec3(0.,.666667,.333333))*6.-3.)-1.,0.,1.);}
vec3 tint(float h){float t=fract(h)*3.;vec3 c=t<1.?mix(uA,uB,t):t<2.?mix(uB,uC,t-1.):mix(uC,uA,t-2.);return mix(c,hsv(h),uRainbow*.85);}`;
const backdropFragment=`precision highp float;
varying vec2 vUv;uniform float uStyle,uTime,uRainbow,uHasGlyph,uDark;
uniform vec3 uA,uB,uC;uniform sampler2D uGlyph;
${colorsGLSL}
float rounded(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return min(max(q.x,q.y),0.)+length(max(q,0.))-r;}
float hash(float n){return fract(sin(n*12.9898)*43758.5453);}
void main(){
 vec2 p=(vUv-.5)*2.,q=p/vec2(.92,.94);float r=length(q);
 float angle=atan(q.y,q.x)/6.283185+.5;
 vec3 color=tint(angle+uTime*.009);float alpha=0.;
 if(uStyle<1.5){
  alpha=exp(-pow((r-.86)*3.8,2.))*.36;
 }else if(uStyle<2.5){
  vec2 a=vec2(-.84+.06*sin(uTime*.24),.35*sin(uTime*.17));
  vec2 b=vec2(.83+.05*cos(uTime*.19),-.42+.18*sin(uTime*.23));
  vec2 c=vec2(.12*sin(uTime*.21),.90+.035*cos(uTime*.18));
  float ga=exp(-dot(p-a,p-a)*12.),gb=exp(-dot(p-b,p-b)*14.),gc=exp(-dot(p-c,p-c)*15.);
  color=(tint(.05+uTime*.01)*ga+tint(.39+uTime*.01)*gb+tint(.7+uTime*.01)*gc)/max(.001,ga+gb+gc);
  float ribbon=exp(-abs(sin(p.x*2.4+p.y*1.8-uTime*.19))*11.);
  float mist=.5+.5*sin(p.y*2.2+sin(p.x*3.+uTime*.13)-uTime*.17);
  alpha=(ga+gb+gc)*.54+ribbon*.14+exp(-dot(p,p)*.7)*mist*.30;
 }else if(uStyle<3.5){
  vec2 portal=p/vec2(.83,.91);float radius=length(portal),theta=atan(portal.y,portal.x);
  float rim=exp(-abs(radius-.94)*85.)+exp(-abs(radius-.88)*120.)*.6;
  float runes=pow(.5+.5*sin(theta*24.-uTime*.8),12.)*exp(-abs(radius-.995)*130.);
  float spiral=pow(.5+.5*sin(theta*4.-radius*22.+uTime*1.3),5.);
  float cloud=(.5+.5*sin(theta*3.+radius*13.-uTime*.6))*(1.-smoothstep(.25,.91,radius));
  float depth=(1.-smoothstep(.1,.89,radius))*.48;
  color=mix(vec3(.075,.095,.17),tint(theta/6.283185+uTime*.012),clamp(rim+spiral*.25+cloud*.35,0.,1.));
  alpha=(rim*.9+runes*.55+spiral*.13+cloud*.27+depth)*(1.-smoothstep(1.01,1.08,radius));
  vec2 floorUV=(p-vec2(0.,-.91))/vec2(.80,.12);float floorR=length(floorUV),floorA=atan(floorUV.y,floorUV.x);
  float sigil=exp(-abs(floorR-.98)*80.)+exp(-abs(floorR-.78)*90.)*.6+exp(-abs(floorR-.91)*90.)*pow(.5+.5*cos(floorA*20.+uTime*.7),9.);
  color+=tint(floorA/6.283185+uTime*.01)*sigil*.6;alpha=max(alpha,min(.8,sigil*.72));

 }else if(uStyle<4.5){
  float w=.42*sin(p.x*2.7+uTime*.20)+.13*sin(p.x*6.-uTime*.13);
  float band=exp(-abs(p.y-w)*7.)*.90+exp(-abs(p.y-w-.30)*11.)*.65;
  float curtain=.65+.35*pow(.5+.5*sin(p.x*26.+sin(p.x*8.+uTime*.14)),2.);
  float haze=exp(-abs(p.y-w+.4)*2.)*.16;
  float sideCurtain=exp(-abs(abs(p.x)-.80-.09*sin(p.y*4.+uTime*.18))*10.);
  vec3 glow=tint(p.x*.3+p.y*.12+uTime*.013);
  color=mix(vec3(.26,.35,.42),vec3(.045,.067,.10),uDark)+glow*(band*curtain*.30+haze*.6+sideCurtain*.62);
  alpha=(.48+min(.09,band*.08))*(1.-smoothstep(.97,1.40,r));
 }else{
  float nebula=exp(-pow(p.y-.32*sin(p.x*3.+uTime*.035),2.)*7.);
  color=mix(vec3(.28,.36,.46),vec3(.035,.048,.078),uDark)+mix(uB,uC,.5+.5*sin(p.x*2.))*nebula*.12;
  alpha=.53*(1.-smoothstep(.98,1.43,r));
  for(int i=0;i<40;i++){
   float n=float(i)+1.;vec2 at=vec2(hash(n)*1.84-.92,hash(n+53.)*1.84-.92);
   vec2 d=p-at;float light=exp(-length(d)*175.)+exp(-abs(d.x)*200.-abs(d.y)*42.)*.34+exp(-abs(d.y)*200.-abs(d.x)*42.)*.34;
   float twinkle=.55+.45*pow(.5+.5*sin(uTime*.85+n*2.),2.);
   color+=mix(tint(n/40.),vec3(1.),.45)*light*twinkle*1.4;
  }
 }
 alpha=clamp(alpha,0.,.96);if(alpha<.003)discard;
 gl_FragColor=vec4(color,alpha);
 #include <colorspace_fragment>
}`;
const reactionFragment=`precision highp float;
varying vec2 vUv;uniform float uStyle,uTime,uEnergy,uDirection,uRainbow;uniform vec3 uA,uB,uC;
${colorsGLSL}
float rounded(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return min(max(q.x,q.y),0.)+length(max(q,0.))-r;}
void main(){
 if(uEnergy<.002)discard;
 vec2 p=(vUv-.5)*vec2(8.,11.);float d=rounded(p,vec2(3.32,4.89),.24);
 if(uStyle>2.5&&uStyle<3.5)d+=sin(p.y*4.2-uTime*6.)*.045*uEnergy;
 float angle=atan(p.y/4.6,p.x/3.1)/6.283185+.5;
 float sweep=pow(.5+.5*cos((angle-uTime*.19+uDirection*.2)*6.283185),7.);
 float rim=exp(-abs(d)*60.),aura=exp(-abs(d)*10.);
 float alpha=uEnergy*(rim*(.26+.62*sweep)+aura*.14);
 if(uStyle<1.5)alpha*=.55;
 if(d<-.03)alpha*=smoothstep(-.20,-.03,d);
 gl_FragColor=vec4(tint(angle+uDirection*.12),clamp(alpha,0.,.85));
 #include <colorspace_fragment>
}`;

export function createCardFx(THREE,scene,root,loader,wake){
 const background=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({vertexShader:backdropVertex,fragmentShader:backdropFragment,transparent:true,depthWrite:false,depthTest:true}));
 background.name='stage-fixed-background';background.frustumCulled=false;background.renderOrder=-10;scene.add(background);
 const reaction=new THREE.Group();reaction.name='card-drag-reaction';root.add(reaction);
 let prefs=normalizeCardFx(),style='halo',theme='#8b7361',time=0,disposed=false,loaded=0;
 const motion=createFxMotion(),textures=[],sprites=[],colorObjects=[new THREE.Color(),new THREE.Color(),new THREE.Color()];
 const blank=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);blank.needsUpdate=true;textures.push(blank);
 const uniforms={uStyle:{value:1},uTime:{value:0},uEnergy:{value:0},uDirection:{value:0},uRainbow:{value:0},uHasGlyph:{value:0},uDark:{value:0},uGlyph:{value:blank},uA:{value:colorObjects[0]},uB:{value:colorObjects[1]},uC:{value:colorObjects[2]}};
 background.material.uniforms=uniforms;
 const outline=new THREE.Mesh(new THREE.PlaneGeometry(8,11),new THREE.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:reactionFragment,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
 outline.name='drag-only-card-light';outline.position.z=-.04;outline.renderOrder=2;reaction.add(outline);
 async function texture(name){try{const t=await loader.loadAsync('./fx-assets/'+name);if(disposed){t.dispose();return null;}t.colorSpace=THREE.NoColorSpace;t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=false;textures.push(t);loaded++;return t;}catch{return null;}}
 const ready=Promise.all([texture('sparkle.png'),texture('portal-rounded-v3.png')]).then(([spark,glyph])=>{
  if(disposed)return;
  if(glyph){uniforms.uGlyph.value=glyph;uniforms.uHasGlyph.value=1;}
  if(spark)for(let i=0;i<18;i++){
   const mesh=new THREE.Mesh(new THREE.PlaneGeometry(.16,.16),new THREE.MeshBasicMaterial({map:spark,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
   mesh.name='drag-spark-'+i;mesh.renderOrder=3;reaction.add(mesh);sprites.push(mesh);
  }
  wake();
 });
 function configure(data={}){
  style=styles.includes(data.style)?data.style:'halo';prefs=normalizeCardFx(data);uniforms.uDark.value=data.scheme==='dark'?1:0;
  if(/^#[0-9a-f]{6}$/i.test(data.themeColor||''))theme=data.themeColor;
  fxColors(prefs,theme).forEach((c,i)=>colorObjects[i].set(c));uniforms.uStyle.value=styles.indexOf(style);uniforms.uRainbow.value=prefs.palette==='rainbow'?1:0;
  background.visible=reaction.visible=style!=='none';if(style==='none'||!prefs.dragEffects)motion.clear();wake();
 }
 function step(dt,tilt,dragging,reduced){
  if(style==='none'){motion.clear();return false;}
  time+=reduced?0:Math.min(.1,dt);
  const m=motion.step(dt,tilt,dragging&&prefs.dragEffects,reduced),energy=prefs.dragEffects?m.energy:0,direction=prefs.dragEffects?m.direction:0;
  uniforms.uTime.value=reduced?0:time;uniforms.uEnergy.value=energy;uniforms.uDirection.value=direction;
  for(const [i,s]of sprites.entries()){
   const phase=i/18*6.28318+time*.10,c=Math.cos(phase),v=Math.sin(phase),r=Math.min(3.43/Math.max(.001,Math.abs(c)),4.99/Math.max(.001,Math.abs(v)));
   const trail=energy*(.12+.09*(i%3));s.position.set(c*r-direction*trail,v*r+Math.sin(time*2+i)*energy*.06,-.1-(i%3)*.1);
   const size=(.18+(i%4)*.04)*(1+energy);s.scale.set(size/.16,size/.16,1);s.rotation.z=time*.2+i;
   s.material.color.copy(colorObjects[i%3]);if(prefs.palette==='rainbow')s.material.color.setHSL((i/18+time*.015)%1,.78,.68);
   s.material.opacity=reduced?0:energy*(.45+.5*Math.sin(time*1.7+i*2)**2);
  }
  return !reduced&&(style!=='halo'||energy>0);
 }
 return {configure,step,ready,clear(){motion.clear();},state(){return {
  style,...prefs,...motion.snapshot(),colors:fxColors(prefs,theme),loadedTextures:loaded,particles:sprites.length,
  background:{fixed:true,visible:background.visible,attachedToCard:background.parent===root,parentIsScene:background.parent===scene,center:[0,0],matrix:background.matrixWorld.toArray()},
  reaction:{attachedToCard:reaction.parent===root,visibleEnergy:uniforms.uEnergy.value}
 };},dispose(){disposed=true;scene.remove(background);root.remove(reaction);background.geometry.dispose();background.material.dispose();reaction.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});textures.forEach(t=>t.dispose());}};
}

export function createCSSCardFx(card){
 const stage=card.parentElement,background=document.createElement('div');background.className='fx-stage-backdrop';background.setAttribute('aria-hidden','true');stage.prepend(background);
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 280 420');svg.classList.add('fx-portal-art');
 const defs=document.createElementNS(ns,'defs'),gradient=document.createElementNS(ns,'linearGradient');gradient.id='stage-fx-gradient';gradient.setAttribute('x2','100%');gradient.setAttribute('y2','100%');
 const stops=Array.from({length:7},(_,i)=>{const s=document.createElementNS(ns,'stop');s.setAttribute('offset',i/6*100+'%');gradient.append(s);return s;});defs.append(gradient);svg.append(defs);
 for(const [rx,ry]of [[128,198],[118,182]]){const e=document.createElementNS(ns,'ellipse');for(const [k,v]of Object.entries({cx:140,cy:210,rx,ry,fill:'none',stroke:'url(#stage-fx-gradient)','stroke-width':1.8}))e.setAttribute(k,v);svg.append(e);}
 const runes=document.createElementNS(ns,'ellipse');for(const [k,v]of Object.entries({cx:140,cy:210,rx:123,ry:190,fill:'none',stroke:'url(#stage-fx-gradient)','stroke-width':3,'stroke-dasharray':'3 15'}))runes.setAttribute(k,v);runes.classList.add('fx-portal-runes');svg.append(runes);background.append(svg);const portal=document.createElement('i');portal.className='fx-portal-generated';background.append(portal);
 const stars=Array.from({length:24},(_,i)=>{const e=document.createElement('i');e.className='fx-backdrop-star';e.style.cssText=`left:${4+(i*37)%92}%;top:${4+(i*53)%92}%;animation-delay:${-i*.47}s`;background.append(e);return e;});
 for(let i=0;i<3;i++){const b=document.createElement('i');b.className='fx-bokeh fx-bokeh-'+i;background.append(b);}
 const border=document.createElement('div');border.className='fx-css-border';border.setAttribute('aria-hidden','true');card.append(border);
 const sprites=Array.from({length:12},()=>{const e=document.createElement('i');e.className='fx-css-spark';e.setAttribute('aria-hidden','true');card.append(e);return e;});
 let prefs=normalizeCardFx(),style='halo',theme='#8b7361',time=0,active=true,isReduced=false;const motion=createFxMotion();
 function playing(){background.style.setProperty('--fx-play',active&&!isReduced?'running':'paused');}
 function configure(data={}){
  style=styles.includes(data.style)?data.style:'halo';prefs=normalizeCardFx(data);if(/^#[0-9a-f]{6}$/i.test(data.themeColor||''))theme=data.themeColor;
  stage.dataset.fxScheme=data.scheme==='dark'?'dark':'light';stage.dataset.fxStyle=card.dataset.fxStyle=style;const colors=fxColors(prefs,theme);
  for(const element of [background,card]){colors.forEach((c,i)=>element.style.setProperty('--fx-'+i,c));element.style.setProperty('--fx-gradient',prefs.palette==='rainbow'?'conic-gradient(#ff6b8b,#ffb54d,#d6dc56,#61d4b2,#58b5ed,#ae8cef,#ff6b8b)':`conic-gradient(${colors[0]},${colors[1]},${colors[2]},${colors[0]})`);}
  const rainbow=['#ff6b8b','#ffb54d','#d6dc56','#61d4b2','#58b5ed','#ae8cef','#ff6b8b'],multi=[colors[0],colors[0],colors[1],colors[1],colors[2],colors[2],colors[0]];stops.forEach((s,i)=>s.setAttribute('stop-color',prefs.palette==='rainbow'?rainbow[i]:multi[i]));stars.forEach((s,i)=>s.style.backgroundColor=colors[i%3]);
  if(style==='none'||!prefs.dragEffects)motion.clear();
 }
 function step(dt,tilt,dragging,reduced){
  isReduced=reduced;playing();if(style==='none'){motion.clear();return false;}
  time+=reduced?0:Math.min(.1,dt);const m=motion.step(dt,tilt,dragging&&prefs.dragEffects,reduced),energy=prefs.dragEffects?m.energy:0,d=prefs.dragEffects?m.direction:0;
  card.style.setProperty('--fx-phase',`${(time*9+d*18)%100}%`);card.style.setProperty('--fx-energy',String(energy));
  for(const [i,s]of sprites.entries()){const phase=i/12*6.28318+time*.095,c=Math.cos(phase),v=Math.sin(phase),r=Math.min(.52/Math.max(.001,Math.abs(c)),.52/Math.max(.001,Math.abs(v)));s.style.left=`${(c*r+.5-d*energy*.025)*100}%`;s.style.top=`${(v*r+.5)*100}%`;s.style.opacity=String(reduced?0:energy*(.3+.65*Math.sin(time*1.7+i*2)**2));s.style.backgroundColor=fxColors(prefs,theme)[i%3];}
  return !reduced&&energy>0;
 }
 return {configure,step,clear(){motion.clear();},setActive(value){active=value;playing();},state(){return {style,...prefs,...motion.snapshot(),colors:fxColors(prefs,theme),particles:sprites.length,background:{fixed:true,visible:getComputedStyle(background).display!=='none',attachedToCard:background.parentElement===card,parentIsStage:background.parentElement===stage,center:[0,0],transform:getComputedStyle(background).transform},reaction:{attachedToCard:border.parentElement===card,visibleEnergy:Number(card.style.getPropertyValue('--fx-energy'))||0}};},dispose(){for(const e of [background,border,...sprites])e.remove();}};
}
