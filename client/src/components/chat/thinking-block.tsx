import { useState, useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";

interface ThinkingBlockProps {
  text: string;
}

export function ThinkingBlock({ text }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(true); // Default expanded
  const [displayText, setDisplayText] = useState("");
  const prevTextRef = useRef("");

  // Accumulate text properly - append new content instead of replacing
  useEffect(() => {
    if (text && !text.startsWith(prevTextRef.current)) {
      // New content coming in - append it
      setDisplayText((prev) => prev + text.slice(prevTextRef.current.length));
    } else {
      setDisplayText(text);
    }
    prevTextRef.current = text;
  }, [text]);

  if (!displayText) return null;

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
      >
        <Sparkles size={10} className="text-amber-400/60" />
        <span className="text-amber-500/70">Thinking</span>
        <span className="text-[10px] opacity-60">
          {expanded ? "(hide)" : "(show)"}
        </span>
      </button>

      {expanded && (
        <div className="mt-1 pl-2">
          <div className="text-xs text-text-secondary/60 whitespace-pre-wrap leading-relaxed font-mono">
            {displayText}
          </div>
        </div>
      )}
    </div>
  );
}
