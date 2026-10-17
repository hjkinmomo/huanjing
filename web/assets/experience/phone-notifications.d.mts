export type PhoneNotice={key:string;app:string;title:string;body:string;signature:string;roleId?:string;groupId?:string;observedAt:number};
export type PhoneFeed={items:PhoneNotice[];dismissed:Record<string,string>};
export function phoneNotificationScope(s:any):string;
export function phoneNotificationCandidates(s:any,groups?:any):PhoneNotice[];
export function mergePhoneNotifications(prior:Partial<PhoneFeed>,candidates?:PhoneNotice[],now?:number):PhoneFeed;
export function dismissPhoneNotifications(feed:PhoneFeed,keys:string[]):PhoneFeed;
