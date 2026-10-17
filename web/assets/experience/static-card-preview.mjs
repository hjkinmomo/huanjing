let profiles;
const load=()=>profiles||=(fetch('/assets/experience/role-card/profiles.json').then(r=>{if(!r.ok)throw Error('profiles unavailable');return r.json();}).catch(()=>({})));
const path=asset=>asset?.startsWith('./')?'/assets/experience/role-card/'+asset.slice(2):asset;
// Static presentation of the actual registered layers. No WebGL, movement, or iframe.
export function staticCardThumbnail(src,name,safeMedia=v=>v){
 const box=document.createElement('span');box.className='static-card-preview';box.dataset.ready='false';box.setAttribute('aria-label',name+'的整卡静态预览');
 const add=(url,layer)=>{const valid=safeMedia(url);if(!valid)return;const img=document.createElement('img');img.alt='';img.loading='lazy';img.crossOrigin='anonymous';img.src=valid;img.dataset.layer=layer;img.onerror=()=>img.remove();box.append(img);};
 add(src,'subject');
 load().then(index=>{if(!box.isConnected)return;const normalized=value=>{try{return new URL(value,document.baseURI).pathname;}catch{return value;}};const profile=Object.values(index).find(p=>[p.original,...(p.aliases||[])].some(alias=>normalized(alias)===normalized(src)));if(!profile?.assets?.background)return;box.replaceChildren();for(const kind of ['background','subject','effects'])if(profile.assets[kind])add(path(profile.assets[kind]),kind);for(const ornament of profile.foreground||[]){if(ornament.kind!=='plane'||!ornament.center||!ornament.size)continue;const url=safeMedia(path(ornament.asset));if(!url)continue;const img=document.createElement('img');img.crossOrigin='anonymous';img.src=url;img.alt='';img.loading='lazy';img.dataset.layer='ornament';img.style.setProperty('--ornament-x',(ornament.center[0]*100)+'%');img.style.setProperty('--ornament-y',(ornament.center[1]*100)+'%');img.style.setProperty('--ornament-w',(ornament.size[0]*100)+'%');img.style.setProperty('--ornament-h',(ornament.size[1]*100)+'%');box.append(img);}const plate=document.createElement('b');plate.textContent=name;box.append(plate);box.dataset.profile=profile.id;}).finally(()=>{box.dataset.ready='true';});
 return box;
}
