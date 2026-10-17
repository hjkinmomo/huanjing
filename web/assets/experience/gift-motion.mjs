import {createLeisureMotion} from './leisure-motion.mjs';
const controllers=new WeakMap();
export function giftMotion(panel,{reduced=false}={}){
 if(!panel)return;controllers.get(panel)?.stop();panel.querySelector('.gift-seal')?.remove();panel.querySelector('.gift-sparks')?.remove();
 if(panel.hidden||reduced||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const motion=createLeisureMotion();controllers.set(panel,motion);
 panel.querySelector('.gift-sparks')?.remove();
 const sparks=document.createElement('span');sparks.className='gift-sparks';sparks.setAttribute('aria-hidden','true');panel.append(sparks);
 for(let i=0;i<8;i++){const dot=document.createElement('i');dot.style.setProperty('--angle',`${i*45}deg`);dot.style.setProperty('--delay',`${i%3*35}ms`);sparks.append(dot);}
 const animation=motion.play(panel,[{opacity:.5,transform:'translateY(8px) scale(.985)'},{opacity:1,transform:'none'}]);
 const image=panel.querySelector('img');if(image&&!image.hidden)motion.play(image,[{transform:'translateY(8px) scale(.7)',opacity:.2},{transform:'translateY(-3px) scale(1.04)',opacity:1,offset:.65},{transform:'none',opacity:1}],{duration:480});
 const seal=document.createElement('span');seal.className='gift-seal';seal.setAttribute('aria-hidden','true');panel.append(seal);motion.play(seal,[{opacity:0,transform:'scale(.6) rotate(-20deg)'},{opacity:.45,transform:'scale(1)',offset:.4},{opacity:0,transform:'scale(1.5) rotate(15deg)'}],{duration:650});
 const cleanup=()=>{sparks.remove();seal.remove();};setTimeout(cleanup,1100);animation?.addEventListener('cancel',cleanup,{once:true});
}
