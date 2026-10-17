import {useEffect,useRef,useState,type ReactNode} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {CopyButton} from './CopyButton';
import {remarkCjkEmphasis} from './remarkCjkEmphasis';
import type {Message,ChatActions} from './chat-types';

function CodeBlock({children}:{children?:ReactNode}){
  const ref=useRef<HTMLPreElement>(null),[source,setSource]=useState('');
  useEffect(()=>{setSource(ref.current?.textContent||'');},[children]);
  return <div className="message-code"><CopyButton text={source} label="复制代码" className="code-copy" icon={false}/><pre ref={ref} tabIndex={0}>{children}</pre></div>;
}
export function MessageContent({text}:{text:string}){
  return <div className="message-content markdown-content"><Markdown remarkPlugins={[remarkGfm,remarkCjkEmphasis]} skipHtml urlTransform={url=>/^https?:\/\//i.test(url)?url:''} components={{
    a:({href,children})=>href?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
    img:({alt})=><span className="external-image-note">[图片：{alt||'外部图片'}，未自动加载]</span>,
    pre:({children})=><CodeBlock>{children}</CodeBlock>,
    table:({children})=><div className="message-table" tabIndex={0} role="region" aria-label="回复表格，可左右滚动"><table>{children}</table></div>,
  }}>{text}</Markdown></div>;
}
export function MessageAttachments({attachments,resolve}:{attachments:NonNullable<Message['attachments']>;resolve?:ChatActions['resolveAttachment']}){
  const [image,setImage]=useState<{url:string;name:string}|null>(null),[status,setStatus]=useState(''),[loading,setLoading]=useState(false);
  const generation=useRef(0),dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(image)dialog.current?.showModal();return()=>{if(image)URL.revokeObjectURL(image.url);};},[image]);
  useEffect(()=>()=>{generation.current++;},[]);
  async function show(id?:string,name='图片'){
    if(!id||!resolve){setStatus('此附件没有本地文件编号。');return;}
    const request=++generation.current;setLoading(true);setStatus('');
    try{const blob=await resolve(id);if(request!==generation.current)return;if(!blob||!['image/png','image/jpeg','image/webp'].includes(blob.type)||blob.size>8*1024*1024)throw Error('此图片已不在本地，或格式/大小暂不支持。');setImage({url:URL.createObjectURL(blob),name});}
    catch(e){if(request===generation.current)setStatus(e instanceof Error?e.message:'图片读取失败。');}
    finally{if(request===generation.current)setLoading(false);}
  }
  return <div className="message-attachments">{attachments.slice(0,12).map((a,i)=><button type="button" key={`${a.id||i}`} disabled={loading} onClick={()=>show(a.id,a.name)}>{a.name||'图片'} · 查看</button>)}{status&&<span role="status">{status}</span>}<dialog ref={dialog} className="attachment-dialog" aria-label="聊天附件" onClose={()=>setImage(null)}>{image&&<><h2>{image.name}</h2><button type="button" onClick={()=>dialog.current?.close()}>关闭图片</button><img src={image.url} alt={image.name}/></>}</dialog></div>;
}
