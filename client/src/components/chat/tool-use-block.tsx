import { useState } from "react";
import {
  Terminal,
  FileText,
  Pencil,
  FolderSearch,
  Search,
  FileOutput,
  Globe,
  ChevronDown,
  ChevronRight,
  Bot,
} from "lucide-react";

interface ToolUseBlockProps {
  name: string;
  input: unknown;
}

const TOOL_ICONS: Record<string, typeof Terminal> = {
  Bash: Terminal,
  Read: FileText,
  Edit: Pencil,
  Write: FileOutput,
  Glob: FolderSearch,
  Grep: Search,
  WebSearch: Globe,
  WebFetch: Globe,
  Agent: Bot,
};

export function ToolUseBlock({ name, input }: ToolUseBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[name] || Terminal;
  const inp = input as Record<string, unknown>;

  let summary = "";
  switch (name) {
    case "Bash":
      summary = (inp.command as string) || "";
      break;
    case "Read":
    case "Edit":
    case "Write":
      summary = (inp.file_path as string) || "";
      break;
    case "Glob":
    case "Grep":
      summary = (inp.pattern as string) || "";
      break;
    case "WebSearch":
      summary = (inp.query as string) || "";
      break;
    case "WebFetch":
      summary = (inp.url as string) || "";
      break;
    case "Agent":
      summary = (inp.description as string) || (inp.prompt as string)?.slice(0, 50) || "";
      break;
    default:
      summary = JSON.stringify(input).slice(0, 80);
  }

  return (
    <div className="rounded-lg bg-bg-secondary border border-border/60 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-bg-hover/50 transition-colors"
      >
        <Icon size={13} className="text-accent/80 flex-shrink-0" />
        <span className="font-mono font-medium text-text-primary">{name}</span>
        <span className="text-text-muted truncate flex-1 text-left font-mono">
          {summary}
        </span>
        {expanded ? (
          <ChevronDown size={12} className="text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-text-muted flex-shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/40">
          <pre className="text-xs text-text-secondary mt-2 whitespace-pre-wrap overflow-x-auto leading-relaxed">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
