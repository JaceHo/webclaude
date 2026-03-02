import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface ThinkingBlockProps {
  text: string;
}

export function ThinkingBlock({ text }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (!text) return null;

  return (
    <div className="rounded-lg bg-thinking/30 border border-border/40 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        <span className="text-amber-500/80 font-medium">Thinking</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {!expanded && (
          <span className="text-text-muted truncate flex-1 text-left">
            {text.slice(0, 100)}...
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-[0.8rem] text-text-secondary/80 whitespace-pre-wrap leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
}
