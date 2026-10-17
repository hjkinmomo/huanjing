// CommonMark can leave **Chinese punctuation。**adjacent text unparsed.
// Repair only remaining CJK text delimiters in prose; never rewrite source/history.
type Node={type:string;value?:string;children?:Node[];position?:{start:{offset?:number};end:{offset?:number}}};
export function remarkCjkEmphasis(){
  return (tree:Node,file:{value?:unknown})=>{
    const source=String(file.value??'');
    function visit(parent:Node){
      if(!parent.children||['code','inlineCode','html','strong','emphasis'].includes(parent.type))return;
      parent.children=parent.children.flatMap(node=>{
        if(node.type!=='text'||!node.value){visit(node);return [node];}
        const raw=source.slice(node.position?.start.offset??0,node.position?.end.offset??0);
        if(/\\[*]/.test(raw))return [node];
        const pattern=/\*\*([^*\n]*[\u3400-\u9fff][^*\n]*)\*\*/g,parts:Node[]=[];let last=0;
        for(const match of node.value.matchAll(pattern)){
          const index=match.index!;
          if(index>last)parts.push({type:'text',value:node.value.slice(last,index)});
          parts.push({type:'strong',children:[{type:'text',value:match[1]}]});last=index+match[0].length;
        }
        if(!parts.length)return [node];
        if(last<node.value.length)parts.push({type:'text',value:node.value.slice(last)});
        return parts;
      });
    }
    visit(tree);
  };
}
