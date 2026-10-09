import { useEffect, useRef } from 'react';
import { Sheet } from './ui';

/** Last resort when this phone won't share or copy automatically: the text, selected, to copy by hand. */
export function CopySheet({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="stack">
        <div className="small muted">Sharing isn't available here. Press and hold the text below, choose Copy, then paste it into the chat.</div>
        <textarea ref={ref} className="input" readOnly rows={Math.min(14, text.split('\n').length + 1)} value={text} onFocus={(e) => e.target.select()} />
        <button className="btn block" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
