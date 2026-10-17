import {phonePreferences} from './phone-preferences.mjs';
export function albumReferences(ids,p=phonePreferences()){
 const keys=new Set(ids);return [['avatar','微聊头像'],['momentsCover','朋友圈封面'],['wallpaper','手机壁纸'],['chatWallpaper','聊天背景']].filter(([key])=>keys.has(p[key])).map(([key,label])=>({id:p[key],label}));
}
