// Only the ten intentionally empty templates need an authored persona first.
// Existing user roles retain their current behavior; assistant sessions are independent.
export const rolePersonaReady=role=>role?.configurationTemplate!==true||!!role?.card?.persona?.trim();
export const roleSetupLabel=role=>rolePersonaReady(role)?'角色设定已填写':'立绘已就绪 · 人格待填写';
