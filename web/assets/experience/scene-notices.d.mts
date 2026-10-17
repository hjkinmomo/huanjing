export type SceneNotice='format_repaired'|'parts_skipped'|'scene_retained'|'scene_fields_retained'|'scene_pending'|'reply_partial';
export const SCENE_NOTICES:Readonly<Record<SceneNotice,string>>;
export function normalizeSceneNotices(value:unknown):SceneNotice[];
