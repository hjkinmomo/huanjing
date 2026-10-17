import {PhonePublicCard} from './PhoneSocial';
import {PhoneAlbum} from './PhoneAlbum';
import {localMedia} from '../../web/assets/experience/phone-local.mjs';
import {importWallpaper} from '../../web/assets/experience/phone-preferences.mjs';
import {useEffect,useState} from 'react';
import {Avatar} from './Avatar';
import {phoneAvatar} from '../../web/assets/experience/phone-avatars.mjs';
import {savePhonePreferences} from '../../web/assets/experience/phone-preferences.mjs';
import {UiIcon} from './UiIcon';
import type {ChatSnapshot,ChatActions} from './chat-types';
export function PhoneProfile({s,actions,preferences:p,self,openMoments,openSettings,chat}:{s:ChatSnapshot;actions?:ChatActions;preferences:any;self:boolean;openMoments:()=>void;openSettings:()=>void;chat:()=>void}){
 const [album,setAlbum]=useState(''),[avatar,setAvatar]=useState('');useEffect(()=>{let active=true,url='';if(self&&p.avatar)localMedia.read(p.avatar).then((r:any)=>{if(active&&r?.blob){url=URL.createObjectURL(r.blob);setAvatar(url);}}).catch(()=>{});return()=>{active=false;if(url)URL.revokeObjectURL(url);};},[self,p.avatar]);
 const [name,setName]=useState(self?p.nickname||s.userName||'你':p.contacts?.[s.roleId]||''),[signature,setSignature]=useState(p.signature||''),[note,setNote]=useState('');
 return <section className="phone-profile"><header><Avatar src={self?avatar||s.userAvatar||'':phoneAvatar(s.roleId,s.avatar)} name={self?p.nickname||s.userName||'你':p.contacts?.[s.roleId]||s.name} className="phone-profile-avatar"/><div><h3>{self?p.nickname||s.userName||'你':p.contacts?.[s.roleId]||s.name}</h3><span>{self?'我的微聊名片':s.name+' · 联系人'}</span></div></header>{self&&p.signature&&<p>{p.signature}</p>}
 {!self&&<PhonePublicCard s={s} actions={actions||{} as ChatActions}/>}
 {self&&<><button className="phone-profile-row" onClick={()=>setAlbum('avatar')}><UiIcon name="image"/>更换头像<UiIcon name="right"/></button><button className="phone-profile-row" onClick={()=>setAlbum('momentsCover')}><UiIcon name="image"/>朋友圈封面<UiIcon name="right"/></button></>}
 {album&&<PhoneAlbum mode={s.personaMode} close={()=>setAlbum('')} choose={id=>{savePhonePreferences({[album]:id});setAlbum('');}}/>}

 <button className="phone-profile-row" onClick={openMoments}><UiIcon name="moments"/><span>{self?'我的朋友圈':'他的朋友圈'}</span><UiIcon name="right"/></button>
 {!self&&<button className="phone-profile-row" onClick={chat}><UiIcon name="message"/><span>发消息</span><UiIcon name="right"/></button>}
 <section className="phone-profile-editor"><h3>{self?'微聊资料':'联系人备注'}</h3><label>{self?'昵称':'备注名'}<input value={name} maxLength={40} onChange={e=>setName(e.target.value)}/></label>{self&&<label>签名<textarea value={signature} maxLength={160} rows={3} onChange={e=>setSignature(e.target.value)}/></label>}<button onClick={()=>{savePhonePreferences(self?{nickname:name.trim(),signature:signature.trim()}:{contacts:{...p.contacts,[s.roleId]:name.trim()}});setNote('已保存');}}>保存</button><p role="status">{note}</p></section>
 {self&&<button className="phone-profile-row" onClick={openSettings}><UiIcon name="settings"/><span>聊天背景与手机设置</span><UiIcon name="right"/></button>}
 </section>;
}

