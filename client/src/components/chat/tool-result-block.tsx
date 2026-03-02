import { useState } from "react";
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolResultBlockProps {
  content: string;
  isError?: boolean;
}

const MAX_PREVIEW = 500;

export function ToolResultBlock({ content, isError }: ToolResultBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > MAX_PREVIEW;

  return (
    <div
      className={cn(
        "rounded-lg overflow-hidden text-xs",
        isError
          ? "border border-red-800/40 bg-error/15"
          : "border border-border/40 bg-bg-primary/40",
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-bg-hover/30 transition-colors"
      >
        {isError ? (
          <AlertCircle size={11} className="text-red-400/80" />
        ) : (
          <CheckCircle size={11} className="text-green-500/70" />
        )}
        <span className="text-text-muted">
          {isError ? "Error" : "Output"}
          {isLong && ` (${content.length} chars)`}
        </span>
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {expanded && (
        <pre className="px-3 pb-2 text-text-secondary whitespace-pre-wrap break-words overflow-x-auto max-h-80 overflow-y-auto leading-relaxed">
          {content}
        </pre>
      )}
    </div>
  );
}
