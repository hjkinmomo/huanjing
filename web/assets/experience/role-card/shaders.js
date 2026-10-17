import {PARALLAX_LIMITS} from './parallax-limits.mjs';
const vertex = `
varying vec2 vUv;
void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const common = `
precision highp float;
varying vec2 vUv;
uniform float uTime, uFoil, uScale, uDepth, uBgDepth, uFinish, uHasLine, uRelief, uSafeScale, uFxDepth, uHasFx;
uniform vec2 uFit, uSafeOffset, uBgFit;
uniform vec3 uView;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float inside(vec2 p) { return step(0.,p.x)*step(0.,p.y)*step(p.x,1.)*step(p.y,1.); }
vec2 parallax(vec2 uv, float depth) {
  vec2 travel=vec2(${PARALLAX_LIMITS.printX},${PARALLAX_LIMITS.printY});
  return uv + clamp(uView.xy / max(abs(uView.z), .4) * depth * .10,-travel,travel);
}
vec3 spectrum(float phase) {
  return .66 + .25 * cos(6.28318 * (phase + vec3(0., .33, .67)));
}
// Stable material codes: pearl=0, silver=1, original=2, gold=3, glitter=4, iridescent=5.
float gold() { return 1.-step(.1,abs(uFinish-3.)); }
float strength() { return abs(uFinish - 2.0) < 0.05 ? 0. : clamp(uFoil*1.6+.10,.28,.72); }
vec3 film(vec2 uv) {
  float phase = uv.x * .85 + uv.y * .55 + uView.x * 1.5 - uView.y * .9;
  if (abs(uFinish-3.) < .1) {
    // 烫金 (gold foil): warm gold laminate that shifts with the viewing angle.
    float hi = 0.5 + 0.5 * sin(phase * 6.28318);
    float glint = 0.5 + 0.5 * cos((phase + 0.25) * 6.28318);
    vec3 deep = vec3(.72, .50, .20);
    vec3 bright = vec3(1.00, .90, .60);
    return mix(deep, bright, hi * .7 + glint * .3);
  }
  if(uFinish>3.5)return .58+.42*cos(6.28318*(phase+vec3(0.,.33,.67)));
  vec3 color = spectrum(phase);
  return mix(color, vec3(dot(color,vec3(.2126,.7152,.0722))), step(.5,uFinish));
}
float sweep(vec2 uv) {
  return pow(.5+.5*sin((uv.x*.72+uv.y*.45+uView.x*1.2+uView.y*.6)*6.283),10.);
}
`;
const frontFragment =
  common +
  `
uniform sampler2D tSubject, tBackground, tText, tLine, tEffects, tParts, tDetails, tFineA, tFineB;
uniform vec4 uFace;
uniform vec2 uDetailOffsets[12];
uniform vec3 uDetailDepthA, uDetailDepthB, uDetailDepthC, uDetailDepthD;
uniform float uPortal;uniform vec3 uPortalA,uPortalB;
uniform float uDetailStrength,uFxRegistered,uFxBehindOnly,uGrounded,uContactY,uContactDepth,uContactBand,uAutoInk;
vec2 effectUV(vec2 uv,float depth){return (parallax(uv,depth)-.5)*mix(1.,uScale,uFxRegistered)/mix(vec2(1.),uFit,uFxRegistered)+.5;}
float clothHeight(vec2 q){
 vec3 a=texture2D(tParts,q).rgb,b=texture2D(tDetails,q).rgb;
 vec3 c=texture2D(tFineA,q).rgb,d=texture2D(tFineB,q).rgb;
 return (dot(a,uDetailDepthA)+dot(b,uDetailDepthB)+dot(c,uDetailDepthC)+dot(d,uDetailDepthD))/max(1.,dot(a+b+c+d,vec3(1.)));
}
void main() {
  vec2 uv = vUv;
  // Keep feet/chair supports with the connected actor, ahead of the backdrop.
  // A shallow contact band softens the motion without pulling legs backwards.
  vec2 flatSubject=(uv-.5)*uScale/uFit+.5+uSafeOffset;
  float contact=smoothstep(uContactY-uContactBand,uContactY+.01,1.-flatSubject.y)*uGrounded;
  float actorDepth=mix(uDepth,uContactDepth,contact);
  vec2 su = ((parallax(uv,actorDepth)-.5)*uScale/uFit+.5)*uSafeScale+uSafeOffset;
  vec2 bu = (parallax(uv,uBgDepth+smoothstep(.25,.95,uv.y)*.035)-.5)*uBgFit+.5;
  // Complete art remains connected. Only clothing interiors have a local relief;
  // heads, hair, skin and limbs stay registered to the original illustration.
  vec3 a = texture2D(tParts,clamp(su,0.,1.)).rgb;
  vec3 b = texture2D(tDetails,clamp(su,0.,1.)).rgb;
  vec3 c=texture2D(tFineA,clamp(su,0.,1.)).rgb;
  vec3 d=texture2D(tFineB,clamp(su,0.,1.)).rgb;
  float total=max(1.,dot(a+b+c+d,vec3(1.)));a/=total;b/=total;c/=total;d/=total;
  float height=dot(a,uDetailDepthA)+dot(b,uDetailDepthB)+dot(c,uDetailDepthC)+dot(d,uDetailDepthD);
  vec2 lag=uDetailOffsets[0]*a.r+uDetailOffsets[1]*a.g+uDetailOffsets[2]*a.b+uDetailOffsets[3]*b.r+uDetailOffsets[4]*b.g+uDetailOffsets[5]*b.b+uDetailOffsets[6]*c.r+uDetailOffsets[7]*c.g+uDetailOffsets[8]*c.b+uDetailOffsets[9]*d.r+uDetailOffsets[10]*d.g+uDetailOffsets[11]*d.b;
  vec2 relief=uView.xy/max(abs(uView.z),.4)*height*.10*uScale/uFit;
  vec2 partUv=su+clamp(relief+lag,vec2(-.003),vec2(.003))*uDetailStrength;
  vec4 subject = texture2D(tSubject,clamp(partUv,0.,1.));
  subject.a *= inside(su)*(1.-uRelief);
  vec3 bg = texture2D(tBackground,clamp(bu,0.,1.)).rgb;

  // A soft, view-relative cast shadow separates the registered silhouette from
  // the print. Sample the same warped coordinates to avoid a second outline.
  vec2 shadowUv=partUv-vec2(.006,.009)-uView.xy*.003;
  float shade=texture2D(tSubject,clamp(shadowUv,0.,1.)).a*.5;
  shade+=texture2D(tSubject,clamp(shadowUv+vec2(.003,0.),0.,1.)).a*.25;
  shade+=texture2D(tSubject,clamp(shadowUv-vec2(.003,0.),0.,1.)).a*.25;
  bg*=1.-shade*inside(shadowUv)*(1.-subject.a)*(1.-uRelief)*.16;
  // Four registered decorative sectors, with distinct view-dependent depths.
  vec2 f0=effectUV(uv,uFxDepth-.24),f1=effectUV(uv,uFxDepth-.08);
  vec2 f2=effectUV(uv,uFxDepth+.12),f3=effectUV(uv,uFxDepth+.25);
  vec4 e0=texture2D(tEffects,clamp(f0,0.,1.)),e1=texture2D(tEffects,clamp(f1,0.,1.));
  vec4 e2=texture2D(tEffects,clamp(f2,0.,1.)),e3=texture2D(tEffects,clamp(f3,0.,1.));
  float w0=(1.-smoothstep(.44,.56,f0.x))*(1.-smoothstep(.43,.57,f0.y));
  float w1=smoothstep(.44,.56,f1.x)*(1.-smoothstep(.43,.57,f1.y));
  float w2=(1.-smoothstep(.44,.56,f2.x))*smoothstep(.43,.57,f2.y);
  float w3=smoothstep(.44,.56,f3.x)*smoothstep(.43,.57,f3.y);
  bg=mix(bg,e0.rgb,e0.a*w0*inside(f0)*uHasFx*.48);
  bg=mix(bg,e1.rgb,e1.a*w1*inside(f1)*uHasFx*.48);
  // Image-top corresponds to high sampling Y after TextureLoader.flipY.
  // Registered orbit art goes behind the intact actor; separate geometry
  // supplies the lower arc in front, so no ring can stripe the face.
  bg=mix(bg,e2.rgb,e2.a*w2*inside(f2)*uHasFx*uFxBehindOnly*.8);
  bg=mix(bg,e3.rgb,e3.a*w3*inside(f3)*uHasFx*uFxBehindOnly*.8);
  vec3 col=mix(bg,subject.rgb,subject.a);
  // Profile coordinates use the image's top-left origin. Texture sampling uses
  // bottom-left UVs after TextureLoader.flipY; convert only the analytic mask.
  vec2 sourceUv=vec2(su.x,1.-su.y);
  float face=1.-smoothstep(.85,1.3,length((sourceUv-uFace.xy)/max(uFace.zw,vec2(.0001))));
  // Gold belongs to the laminate: keep the face's painted skin tones.
  // Approximate motion masks are too coarse for strong color grading: a gentle
  // uniform subject tint avoids visible polygon boundaries on pale clothing.
  float goldArea=mix(.85,.18,subject.a)*(1.-face*.92);
  if(gold()>.5)col=mix(col,col*vec3(1.02,.95,.78)+vec3(.05,.012,0.),goldArea);
  col=mix(col,e2.rgb,e2.a*w2*inside(f2)*uHasFx*(1.-uRelief)*(1.-uFxBehindOnly)*.48);
  col=mix(col,e3.rgb,e3.a*w3*inside(f3)*uHasFx*(1.-uRelief)*(1.-uFxBehindOnly)*.48);
  vec3 foil = film(uv);
  float amount = strength()*(1.-face*.78);
  float luminance = dot(col,vec3(.2126,.7152,.0722));
  float band = sweep(uv);
  // Source-registered masks give fabric broad satin light and ornaments a
  // narrower glint. Skin/face and original finish keep their painted values.
  float cloth=clamp(dot(a+b+c,vec3(1.))+d.b,0.,1.);
  float ornament=clamp(b.b+d.r+d.g*.5,0.,1.);
  float satin=pow(.5+.5*sin((su.x*.65-su.y*.28+uView.x*.7)*6.28318),3.);
  float metal=pow(.5+.5*sin((su.x+su.y*.3+uView.x*1.7-uView.y*.5)*6.28318),24.);
  col+=foil*amount*subject.a*(1.-face)*(.055*cloth*satin+.12*ornament*metal);
  // Gentle view-dependent seam lighting separates stacked cloth and trims.
  // No stamped polygon tint or secondary body silhouette is introduced.
  vec2 gradient=vec2(clothHeight(su+vec2(.003,0.))-clothHeight(su-vec2(.003,0.)),clothHeight(su+vec2(0.,.003))-clothHeight(su-vec2(0.,.003)));
  float seam=clamp(dot(gradient,uView.xy)*1.6,-.035,.035);
  col*=1.+seam*subject.a*(1.-face)*uDetailStrength*step(.1,strength());
  // Laminate changes with the card-local viewing direction; black print stays readable.
  float goldBoost = gold()>.5 ? 1.7 : 1.25;
  col *= 1. - amount * .21 * (1.-foil) * (.2 + band*.8);
  col += foil * amount * band * goldBoost * (.10 + .14*(1.-luminance));
  // Broad optical laminate and sparse flakes; never redraw or distort the face.
  if(uFinish<.5)col+=foil*amount*band*.09*(1.-face*.9);
  if(abs(uFinish-1.)<.1)col+=vec3(.88,.95,1.)*amount*band*.10*(1.-face*.9);
  if(uFinish>4.5){
    float prism=pow(.5+.5*sin((uv.x*.7-uv.y*.32+uView.x*.85)*36.),14.);
    col=mix(col,col*(foil*.65+.6),amount*(.10+band*.30)*(1.-face*.93));
    col+=foil*prism*amount*.15*(1.-face*.93);
  }
  float edge = 1.-smoothstep(.015,.06,min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y)));
  col = mix(col,foil*.75+.21,edge*amount*(gold()>.5 ? .42 : .3));
  float bevel=(1.-smoothstep(.003,.013,min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y))));
  col+=foil*bevel*amount*.075*(.5+.5*clamp(uView.x-uView.y,-1.,1.));
  vec2 cell = floor(uv*vec2(480.,720.));
  float flake = step(.994,hash(cell))*pow(.5+.5*sin(hash(cell+8.)*30.+uView.x*20.+uTime*.6),10.);
  col += foil*flake*amount*.13;
  if(abs(uFinish-4.)<.1){
    vec2 grain=floor(uv*vec2(100.,150.)),local=fract(uv*vec2(100.,150.))-.5;
    float cross=exp(-abs(local.x)*65.-abs(local.y)*7.)+exp(-abs(local.y)*65.-abs(local.x)*7.);
    float sparkle=step(.977,hash(grain))*pow(.5+.5*sin(hash(grain+3.)*40.+uView.x*27.-uView.y*18.),6.);
    col+=foil*cross*sparkle*.85*(1.-face*.97);
    col+=foil*amount*band*.13*(1.-face*.93);
  }
  float line = (1.-smoothstep(.06,.25,texture2D(tLine,clamp(partUv,0.,1.)).r))*uHasLine;
  // Derive sparse ink glints from the exact sprite, without a drifting redraw.
  vec2 pixel=vec2(1./1024.,1./1536.);
  float inkX=abs(dot(texture2D(tSubject,partUv+vec2(pixel.x,0.)).rgb-texture2D(tSubject,partUv-vec2(pixel.x,0.)).rgb,vec3(.2126,.7152,.0722)));
  float inkY=abs(dot(texture2D(tSubject,partUv+vec2(0.,pixel.y)).rgb-texture2D(tSubject,partUv-vec2(0.,pixel.y)).rgb,vec3(.2126,.7152,.0722)));
  line=max(line,smoothstep(.08,.35,max(inkX,inkY))*uAutoInk*(1.-face));
  col += line*inside(su)*subject.a*band*amount*.055;
  vec4 text = texture2D(tText,uv);
  col = mix(col,text.rgb,text.a*(1.-uRelief));
  gl_FragColor = vec4(pow(clamp(col,0.,1.),vec3(2.2)),1.);
  #include <colorspace_fragment>
}
`;
const edgeFragment =
  common +
  `
void main() {
  vec3 col = mix(vec3(.66,.69,.67),film(vUv)*.6+.35,strength()*.7);
  gl_FragColor=vec4(pow(col,vec3(2.2)),1.);
  #include <colorspace_fragment>
}
`;
const backFragment =
  common +
  `
uniform sampler2D tBack;
void main() {
  vec2 uv=vec2(1.-vUv.x,vUv.y);
  vec4 art=texture2D(tBack,uv);
  vec3 paper=gold()>.5?vec3(.96,.92,.81):uFinish>.5&&uFinish<1.5?vec3(.88,.93,.96):vec3(.956,.961,.946);
  if(abs(uFinish-2.)<.05)paper=vec3(.956,.961,.946);
  float border=smoothstep(.32,.49,max(abs(uv.x-.5),abs(uv.y-.5)));
  float engraved=.5+.5*sin((uv.x*22.+sin(uv.y*35.)*.3+uView.x*.8)*6.28318);
  vec3 col=mix(paper,film(vUv)*.65+.28,strength()*.27);
  col+=film(vUv)*sweep(vUv)*strength()*.28;
  if(uFinish>4.5)col=mix(col,film(vUv)*.64+.22,strength()*.42);
  if(abs(uFinish-4.)<.1){vec2 cell=floor(uv*vec2(130.,195.));float flake=step(.972,hash(cell))*pow(.5+.5*sin(hash(cell+3.)*24.+uView.x*23.-uView.y*16.),6.);col+=film(vUv)*flake*.65;}
  col-=vec3(.08,.065,.04)*engraved*border*strength()*.35;
  col=mix(col,art.rgb,art.a);
  gl_FragColor=vec4(pow(clamp(col,0.,1.),vec3(2.2)),1.);
  #include <colorspace_fragment>
}
`;

const subjectFragment = common + `
uniform sampler2D tSubject;
void main() {
  vec4 art=texture2D(tSubject,vUv);
  if(art.a<.06)discard;
  vec2 px=1./vec2(1024.,1630.);
  float inner=min(min(texture2D(tSubject,vUv+vec2(px.x*2.,0.)).a,texture2D(tSubject,vUv-vec2(px.x*2.,0.)).a),min(texture2D(tSubject,vUv+vec2(0.,px.y*2.)).a,texture2D(tSubject,vUv-vec2(0.,px.y*2.)).a));
  vec3 col=art.rgb;
  col+=film(vUv)*sweep(vUv)*strength()*.10;
  col=mix(col,vec3(.86,.72,.40),(1.-inner)*.22);
  gl_FragColor=vec4(pow(clamp(col,0.,1.),vec3(2.2)),art.a);
  #include <colorspace_fragment>
}
`;
const effectsFragment = common + `
uniform sampler2D tEffects;
void main() {
  vec4 art=texture2D(tEffects,vUv);
  // The relief effects layer is a pre-cut RGBA asset: use its real alpha so
  // thorn/spark deco keeps its silhouette instead of a color-channel matte.
  float alpha=art.a;
  if(alpha<.015)discard;
  vec3 col=art.rgb;
  col+=film(vUv)*sweep(vUv)*strength()*.08;
  gl_FragColor=vec4(pow(clamp(col,0.,1.),vec3(2.2)),alpha);
  #include <colorspace_fragment>
}
`;
const textFragment = common + `
uniform sampler2D tText;
void main(){vec4 art=texture2D(tText,vUv);if(art.a<.02)discard;gl_FragColor=vec4(pow(art.rgb,vec3(2.2)),art.a);
  #include <colorspace_fragment>
}
`;


export {vertex,frontFragment,edgeFragment,backFragment};
