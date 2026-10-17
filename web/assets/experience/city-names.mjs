export const currentCityText=value=>typeof value==='string'?value.replaceAll('澄湾','夏城'):value;
// Rename current authored setting text, never message history, identity names,
// character names, IDs, resources or the user's stored card object.
export function currentCityCard(card={}){
 const result={...card};
 const visit=value=>typeof value==='string'?currentCityText(value):Array.isArray(value)?value.map(visit):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,['id','name','title','src','url'].includes(k)?v:visit(v)])):value;
 for(const key of ['persona','personality','scenario','greeting','speechStyle','systemPrompt','postHistoryInstructions','dialogueExamples','loreBook'])if(key in card)result[key]=visit(card[key]);
 return result;
}
