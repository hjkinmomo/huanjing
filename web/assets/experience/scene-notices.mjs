// Application diagnostics are metadata, never character dialogue or memory evidence.
export const SCENE_NOTICES=Object.freeze({
 format_repaired:'已修复回复中的格式符号，保留模型原文。',
 parts_skipped:'有无法识别的段落，已保留可用对白。',
 scene_retained:'场景信息无效，已保留原地点和状态。',
 scene_fields_retained:'缺漏的状态字段沿用之前的记录；尚未确认的内容留空。',
 scene_pending:'开场场景尚未交代完整；对白已保存，下次继续补充。',
 reply_partial:'回复未完整结束，只保存已完整生成的段落。'
});
export const normalizeSceneNotices=value=>Array.isArray(value)?[...new Set(value.filter(code=>typeof code==='string'&&Object.hasOwn(SCENE_NOTICES,code)))]:[];
