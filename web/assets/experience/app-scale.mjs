export function normalizeAppScale(value){const n=Number(value);return Number.isFinite(n)?Math.min(175,Math.max(50,Math.round(n/5)*5)):100;}
export function appViewport(){const scale=normalizeAppScale(document.documentElement.dataset.appScale||100)/100;return {scale,w:innerWidth/scale,h:innerHeight/scale};}
export function applyAppScale(value){
 const n=normalizeAppScale(value),root=document.documentElement;
 if(root.dataset.appScale===String(n))return;
 root.dataset.appScale=String(n);root.dataset.projectCompact=String(innerWidth/(n/100)<1100);root.style.setProperty('--app-zoom',String(n/100));
 root.style.setProperty('--app-height',`${innerHeight/(n/100)}px`);
 window.dispatchEvent(new Event('huanjing:scale-change'));
}
export function mountAppScale(form){
 const input=form.elements.namedItem('appScale'),output=form.querySelector('[data-scale-value]');
 const refresh=()=>{output.textContent=input.value+'%';};
 input.addEventListener('input',()=>{refresh();input.dispatchEvent(new Event('change',{bubbles:true}));});
 form.querySelectorAll('[data-scale-step]').forEach(b=>b.onclick=()=>{input.value=String(normalizeAppScale(Number(input.value)+Number(b.dataset.scaleStep)));input.dispatchEvent(new Event('input',{bubbles:true}));});
 form.querySelector('[data-scale-reset]').onclick=()=>{input.value='100';input.dispatchEvent(new Event('input',{bubbles:true}));};
 window.addEventListener('resize',()=>{document.documentElement.style.setProperty('--app-height',`${appViewport().h}px`);document.documentElement.dataset.projectCompact=String(appViewport().w<1100);});
 return {refresh};
}
