import type { Session } from "@webclaude/shared";
import { formatCost } from "@/lib/utils";
import { ModelSelector } from "../input/model-selector";
import { Circle } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
  session: Session | null;
  onModelChange: (model: string) => void;
}

export function Header({ session, onModelChange }: HeaderProps) {
  if (!session) {
    return (
      <header className="h-11 border-b border-border bg-bg-primary flex items-center px-4">
        <span className="text-text-muted text-sm">
          Select or create a session
        </span>
      </header>
    );
  }

  return (
    <header className="h-11 border-b border-border bg-bg-primary flex items-center px-4 gap-3">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Circle
          size={7}
          className={cn(
            "flex-shrink-0",
            session.status === "running" && "fill-running text-running pulse-dot",
            session.status === "idle" && "fill-green-500 text-green-500",
            session.status === "error" && "fill-red-500 text-red-500",
          )}
        />
        <h1 className="text-sm font-medium truncate text-text-primary">{session.title}</h1>
      </div>

      <ModelSelector value={session.model} onChange={onModelChange} />

      {session.totalCost > 0 && (
        <span className="text-[11px] text-text-muted font-mono">
          {formatCost(session.totalCost)}
        </span>
      )}
    </header>
  );
}
