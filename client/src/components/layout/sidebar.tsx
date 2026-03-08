import { Plus, RefreshCw } from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";
import type { Session, CreateSessionRequest, CronJob, CreateCronRequest, UpdateCronRequest } from "@ctrlnect/shared";
import { SessionList } from "../session/session-list";
import { CronPanel } from "../cron/cron-panel";
import { ServicePanel } from "../services/service-panel";
import { ItermPanel } from "../iterm/iterm-panel";

import type { SystemService } from "@/hooks/use-services";
import type { ItermSession } from "@/hooks/use-iterm";

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: (req: CreateSessionRequest) => void;
  onDeleteSession: (id: string) => void;
  crons: CronJob[];
  activeCronId: string | null;
  onSelectCron: (id: string | null) => void;
  onCreateCron: (req: CreateCronRequest) => Promise<CronJob>;
  onUpdateCron: (id: string, req: UpdateCronRequest) => Promise<CronJob>;
  onDeleteCron: (id: string) => Promise<void>;
  onTriggerCron: (id: string) => Promise<void>;
  onImportSystemCrons: () => Promise<{ imported: number }>;
  services: SystemService[];
  onStartService: (id: string) => Promise<boolean>;
  onStopService: (id: string) => Promise<boolean>;
  onRestartService: (id: string) => Promise<boolean>;
  onDeleteService: (id: string) => Promise<boolean>;
  onCreateService: (service: { name: string; description?: string; command: string; cwd?: string; logPath?: string }) => Promise<boolean>;
  onUpdateService: (id: string, updates: { name?: string; description?: string; command?: string; cwd?: string; logPath?: string }) => Promise<boolean>;
  onToggleServiceEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  onGetServiceLogs: (id: string) => Promise<string>;
  onDiscoverServices: () => Promise<{ name: string; description: string; command: string; logPath?: string }[]>;
  itermSessions: ItermSession[];
  itermAvailable: boolean;
  activeItermSessionId: string | null;
  onSelectItermSession: (id: string) => void;
  wechatActive: boolean;
  onSelectWeChat: () => void;
  onRefreshAll: () => void;
}

const BOTTOM_HEIGHT_KEY = "ctrlnect_bottom_panel_height";
const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 36;

function getStoredHeight(): number {
  try {
    const v = localStorage.getItem(BOTTOM_HEIGHT_KEY);
    return v ? Math.max(MIN_HEIGHT, parseInt(v, 10)) : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

export function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  crons,
  activeCronId,
  onSelectCron,
  onCreateCron,
  onUpdateCron,
  onDeleteCron,
  onTriggerCron,
  onImportSystemCrons,
  services,
  onStartService,
  onStopService,
  onRestartService,
  onDeleteService,
  onCreateService,
  onUpdateService,
  onToggleServiceEnabled,
  onGetServiceLogs,
  onDiscoverServices,
  itermSessions,
  itermAvailable,
  activeItermSessionId,
  onSelectItermSession,
  wechatActive,
  onSelectWeChat,
  onRefreshAll,
}: SidebarProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshAll = () => {
    setRefreshing(true);
    onRefreshAll();
    setTimeout(() => setRefreshing(false), 800);
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const [bottomHeight, setBottomHeight] = useState(getStoredHeight);

  // Persist height across sessions
  useEffect(() => {
    try { localStorage.setItem(BOTTOM_HEIGHT_KEY, String(bottomHeight)); } catch {}
  }, [bottomHeight]);

  // Drag-to-resize the top edge of the bottom panel
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = bottomHeight;

    const onMove = (me: MouseEvent) => {
      const containerH = containerRef.current?.offsetHeight ?? 600;
      // Dragging up (negative delta clientY) increases bottomHeight
      const delta = startY - me.clientY;
      const newH = Math.max(MIN_HEIGHT, Math.min(containerH - 60, startH + delta));
      setBottomHeight(newH);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [bottomHeight]);

  return (
    <div ref={containerRef} className="absolute inset-0">

      {/* ── Top section: session list, shrinks as bottom panel grows ── */}
      <div
        className="absolute top-0 left-0 right-0 flex flex-col"
        style={{ bottom: bottomHeight }}
      >
        <div className="p-3 border-b border-border flex-shrink-0">
          <button
            onClick={() => onCreateSession({})}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors text-sm"
          >
            <Plus size={15} />
            New Session
          </button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          <SessionList
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={onSelectSession}
            onDelete={onDeleteSession}
            wechatActive={wechatActive}
            onSelectWeChat={onSelectWeChat}
          />
        </div>
      </div>

      {/* ── Bottom panel: z-10, overlays session list when dragged up ── */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-bg-secondary z-10 flex flex-col"
        style={{ height: bottomHeight }}
      >
        {/* Drag handle — resize cursor, subtle grip indicator */}
        <div
          className="h-[5px] flex-shrink-0 cursor-ns-resize border-t border-border bg-bg-secondary hover:bg-blue-500/20 active:bg-blue-500/30 transition-colors select-none group"
          onMouseDown={handleDragStart}
        >
          <div className="flex justify-center pt-[1px]">
            <div className="w-8 h-[3px] rounded-full bg-border group-hover:bg-blue-400/60 transition-colors" />
          </div>
        </div>

        {/* Scrollable panel content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <ItermPanel
            sessions={itermSessions}
            available={itermAvailable}
            activeSessionId={activeItermSessionId}
            onSelect={onSelectItermSession}
          />
          <CronPanel
            crons={crons}
            sessions={sessions}
            activeCronId={activeCronId}
            onSelectCron={onSelectCron}
            onCreateCron={onCreateCron}
            onUpdateCron={onUpdateCron}
            onDeleteCron={onDeleteCron}
            onTriggerCron={onTriggerCron}
            onImportSystemCrons={onImportSystemCrons}
          />
          <ServicePanel
            services={services}
            onStart={onStartService}
            onStop={onStopService}
            onRestart={onRestartService}
            onDelete={onDeleteService}
            onCreate={onCreateService}
            onUpdate={onUpdateService}
            onToggleEnabled={onToggleServiceEnabled}
            onGetLogs={onGetServiceLogs}
            onDiscover={onDiscoverServices}
          />
          <div className="px-3 py-2 border-t border-border flex items-center justify-between">
            <span className="text-[11px] text-text-muted font-light tracking-wide">CtrlNect</span>
            <button
              onClick={handleRefreshAll}
              title="Refresh all — iTerm2, crons, services from disk"
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
