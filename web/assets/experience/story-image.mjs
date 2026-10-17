import {resolveStoryAsset,STORY_BACKGROUNDS} from './story-media.mjs';
// A failed image never silently removes the whole stage. Retry and fallback are
// visible, and original sources resolve against the module rather than the page.
export function createStoryImage(source,{className='',alt='',changed=()=>{},fallback=STORY_BACKGROUNDS[0].image}={}){
 const image=document.createElement('img');image.className=className;image.alt=alt;image.decoding='async';
 let attempt=0,current=resolveStoryAsset(source),disposed=false;
 const announce=state=>{image.dataset.mediaState=state;changed(state);};
 image.onload=()=>{if(!disposed)announce(attempt?'fallback':'ready');};
 image.onerror=()=>{if(disposed)return;if(!attempt&&current!==fallback){attempt=1;announce('fallback-loading');image.src=fallback;}else{image.hidden=true;announce('error');}};
 function retry(){if(disposed)return;attempt=0;image.hidden=false;announce('loading');image.src=current;}
 retry();return {image,retry,close(){disposed=true;image.onload=null;image.onerror=null;}};
}
