import {useEffect, useRef, useState} from 'react';

// Copy raw source rather than rendered Markdown; transient feedback owns its timer.
export function CopyButton({text, label='复制', accessibleLabel, className='message-copy', icon=true}: {
  text: string; label?: string; accessibleLabel?: string; className?: string; icon?: boolean;
}) {
  const [feedback, setFeedback] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const currentText = useRef(text);
  currentText.current = text;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);
  useEffect(() => { setFeedback(''); if (timer.current) clearTimeout(timer.current); }, [text]);
  async function copy() {
    let result = '已复制';
    try { await navigator.clipboard.writeText(text); }
    catch { result = '复制失败，请选择文字'; }
    if (!mounted.current || currentText.current !== text) return;
    setFeedback(result);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback(''), 2000);
  }
  return <button type="button" className={className} onClick={copy} aria-label={accessibleLabel || label} title={feedback || label}>
    {icon && <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>}
    <span>{feedback || label}</span><span className="sr-only" role="status">{feedback}</span>
  </button>;
}
