import avatars from './phone-avatars.json' with {type:'json'};
import {baseRoleId} from './persona-modes.mjs';
export function phoneAvatar(roleId,fallback=''){
 // Uploaded/custom avatars take precedence; only built-in art gets the Q portrait.
 if(fallback&&!fallback.includes('/assets/experience/')&&!fallback.startsWith('./assets/experience/'))return fallback;
 return avatars[baseRoleId(roleId)]||fallback;
}
