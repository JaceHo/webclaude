import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface ToolResultBlockProps {
  content: string;
  isError?: boolean;
}

const MAX_PREVIEW = 300;

export function ToolResultBlock({ content, isError }: ToolResultBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > MAX_PREVIEW;

  // Show first few lines as preview
  const preview = content.split("\n").slice(0, 3).join("\n");
  const showPreview = isLong && !expanded;

  return (
    <div className="my-1 ml-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
      >
        <span className={isError ? "text-red-400/70" : "text-green-500/70"}>
          {isError ? "✕ Error" : "✓ Output"}
        </span>
        {isLong && (
          <>
            <span>({content.length} chars)</span>
            <ChevronDown size={10} className={!expanded ? "rotate-[-90deg]" : ""} />
          </>
        )}
      </button>

      {(expanded || !isLong) && (
        <pre className="mt-1 ml-0 text-[10px] text-text-secondary/70 bg-bg-tertiary/30 p-2 rounded-md overflow-x-auto whitespace-pre-wrap font-mono">
          {showPreview ? preview + "..." : content}
        </pre>
      )}
    </div>
  );
}
