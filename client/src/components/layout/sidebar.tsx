import { Plus } from "lucide-react";
import type { Session, CreateSessionRequest } from "@webclaude/shared";
import { SessionList } from "../session/session-list";

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: (req: CreateSessionRequest) => void;
  onDeleteSession: (id: string) => void;
}

export function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
}: SidebarProps) {
  return (
    <>
      <div className="p-3 border-b border-border">
        <button
          onClick={() => onCreateSession({})}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors text-sm"
        >
          <Plus size={15} />
          New Session
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={onSelectSession}
          onDelete={onDeleteSession}
        />
      </div>
      <div className="p-2.5 border-t border-border text-[11px] text-text-muted text-center font-light tracking-wide">
        WebClaude
      </div>
    </>
  );
}
