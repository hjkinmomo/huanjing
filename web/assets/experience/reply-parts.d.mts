import type {StickerSprite} from './sticker-catalog.mjs';
export type ReplyPart={kind:'text'|'sticker'|'scene'|'inner';text:string;src?:string;sprite?:StickerSprite};
export function replyParts(text:string,roleId?:string,streaming?:boolean,presentation?:boolean):ReplyPart[];
