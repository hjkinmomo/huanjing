import type {StickerSprite} from './sticker-catalog.mjs';
export type UserSticker={id:string;label:string;meaning:string;src:string;sprite?:StickerSprite};
export function userStickerOptions(roleId:string):UserSticker[];
export function userStickerText(roleId:string,id:string):string;
export function parseUserSticker(text:string,roleId:string):UserSticker|null;
