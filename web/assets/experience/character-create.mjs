export function renderCreationPreview(form){
 const value=name=>String(form.elements.namedItem(name)?.value||'').trim();
 const set=(selector,text)=>{const n=form.querySelector(selector);if(n)n.textContent=text;};
 const name=value('name');set('[data-create-initial]',Array.from(name)[0]||'＋');set('[data-create-name]',name||'新角色');set('[data-create-intro]',value('mood')||'一句介绍会显示在角色列表里。');set('[data-create-persona]',value('persona')||'等待填写');set('[data-create-opening]',value('greeting')||value('scenario')||'由你先开口');
}
