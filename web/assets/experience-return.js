(function (root) {
  'use strict';
  function destination(search) {
    const params = new URLSearchParams(search), route = params.get('return'), role = params.get('role');
    if (route === 'edit' && /^[A-Za-z0-9_.:-]{1,80}$/.test(role || '')) return {href:`./experience.html#/edit/${encodeURIComponent(role)}`,label:'返回角色资料'};
    return route === 'bag' ? {href:'./experience.html#/bag',label:'返回背包'} :
      route === 'settings' ? {href:'./experience.html#/settings',label:'返回设置'} : null;
  }
  function mount(document, search) {
    const target = destination(search), link = document.getElementById('experienceReturn');
    if (!target || !link) return;
    link.href = target.href;
    link.textContent = `← ${target.label}`;
    link.setAttribute('aria-label',target.label);
    link.hidden = false;
  }
  if (typeof module === 'object' && module.exports) module.exports = {destination,mount};
  else mount(root.document,root.location.search);
})(typeof globalThis !== 'undefined' ? globalThis : this);
