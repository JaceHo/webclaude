import { useState } from "react";
import {
  Terminal,
  FileText,
  Pencil,
  FolderSearch,
  Search,
  FileOutput,
  Globe,
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

  // Extract compact summary
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
      summary = (inp.description as string) || (inp.prompt as string)?.slice(0, 40) || "";
      break;
    default:
      summary = JSON.stringify(input).slice(0, 60);
  }

  // Truncate summary for display
  const displaySummary = summary.length > 80 ? summary.slice(0, 80) + "..." : summary;

  return (
    <div className="my-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-tertiary/60 hover:bg-bg-tertiary text-xs transition-colors"
      >
        <Icon size={11} className="text-cyan-400/70" />
        <span className="font-medium text-text-secondary">{name}</span>
        <span className="text-text-muted truncate max-w-[200px] font-mono">
          {displaySummary}
        </span>
      </button>

      {expanded && (
        <div className="mt-1 ml-0">
          <pre className="text-xs text-text-muted bg-bg-tertiary/30 p-2 rounded-md overflow-x-auto font-mono">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
