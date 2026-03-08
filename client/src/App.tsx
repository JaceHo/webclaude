import { useState, useCallback, useEffect, useRef } from "react";
import { WSProvider } from "./hooks/use-websocket";
import { useSessions } from "./hooks/use-sessions";
import { useCrons } from "./hooks/use-crons";
import { useServices } from "./hooks/use-services";
import { useIterm } from "./hooks/use-iterm";
import { AppLayout } from "./components/layout/app-layout";
import { Sidebar } from "./components/layout/sidebar";
import { TabBar } from "./components/layout/tab-bar";
import type { TabType, AppTab } from "./components/layout/tab-bar";
import { SessionView } from "./components/session/session-view";
import { CronLogView } from "./components/cron/cron-log-view";
import { ItermView } from "./components/iterm/iterm-view";
import { WeChatView } from "./components/wechat/wechat-view";
import type { CreateSessionRequest } from "@ctrlnect/shared";

const STORAGE_KEY = "ctrlnect_active_session_id";

// Deterministic tab ID — same item always gets the same tab.
const tabId = (type: TabType, itemId: string) => `${type}:${itemId}`;

function AppInner() {
  const { sessions, loading, createSession, updateSession, deleteSession } = useSessions();
  const { crons, createCron, updateCron, deleteCron, triggerCron, importSystemCrons, refreshCrons } = useCrons();
  const { services, createService, updateService, toggleServiceEnabled, deleteService, startService, stopService, restartService, getServiceLogs, discoverServices, refreshServices } = useServices();
  const { sessions: itermSessions, available: itermAvailable, fetchSessions: refreshItermSessions, getContent: getItermContent, sendText: sendItermText } = useIterm();

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<AppTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Derive which item is "active" in each left-panel section from the active tab.
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeSessionId   = activeTab?.type === "session" ? activeTab.itemId : null;
  const activeCronId      = activeTab?.type === "cron"    ? activeTab.itemId : null;
  const activeItermId     = activeTab?.type === "iterm"   ? activeTab.itemId : null;
  const wechatActive      = activeTab?.type === "wechat";

  // ── Tab management ─────────────────────────────────────────────────────────
  const openTab = useCallback((type: TabType, itemId: string) => {
    const id = tabId(type, itemId);
    setTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, type, itemId, label: "" }]));
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    // Compute next active synchronously inside the setter so we have current tabs.
    let nextId: string | null = null;
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx >= 0) {
        nextId = prev[idx + 1]?.id ?? prev[idx - 1]?.id ?? null;
      }
      return prev.filter((t) => t.id !== id);
    });
    setActiveTabId((cur) => (cur === id ? nextId : cur));
  }, []);

  // ── Initial session restore ────────────────────────────────────────────────
  const initialized = useRef(false);
  useEffect(() => {
    if (loading || initialized.current) return;
    if (sessions.length === 0) {
      createSession({}).then((s) => { initialized.current = true; openTab("session", s.id); });
      return;
    }
    initialized.current = true;
    const saved = localStorage.getItem(STORAGE_KEY);
    const target = saved && sessions.some((s) => s.id === saved) ? saved : sessions[0].id;
    openTab("session", target);
  }, [sessions, loading, createSession, openTab]);

  // Save last-used session for restore on next load.
  useEffect(() => {
    if (activeSessionId) localStorage.setItem(STORAGE_KEY, activeSessionId);
  }, [activeSessionId]);

  // ── Navigation handlers ────────────────────────────────────────────────────
  const handleSelectSession      = useCallback((id: string)       => openTab("session", id),  [openTab]);
  const handleSelectCron         = useCallback((id: string | null) => { if (id) openTab("cron", id); }, [openTab]);
  const handleSelectItermSession = useCallback((id: string)       => openTab("iterm",   id),  [openTab]);
  const handleSelectWeChat       = useCallback(()                  => openTab("wechat", "wechat"), [openTab]);

  const handleCreateSession = useCallback(async (req: CreateSessionRequest) => {
    const session = await createSession(req);
    openTab("session", session.id);
  }, [createSession, openTab]);

  const handleDeleteSession = useCallback(async (id: string) => {
    await deleteSession(id);
    closeTab(tabId("session", id));
    // If no tabs remain after close, open a new blank session.
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== tabId("session", id));
      if (remaining.length === 0) {
        createSession({}).then((s) => openTab("session", s.id));
      }
      return remaining;
    });
  }, [deleteSession, closeTab, createSession, openTab]);

  // Close a cron tab if the cron is deleted from the sidebar.
  const handleDeleteCron = useCallback(async (id: string) => {
    await deleteCron(id);
    closeTab(tabId("cron", id));
  }, [deleteCron, closeTab]);

  // ── Tab label derivation ───────────────────────────────────────────────────
  // Labels are derived live from data so they update when names change.
  const resolvedTabs: AppTab[] = tabs.map((t) => {
    let label = t.label;
    if (t.type === "session") {
      label = sessions.find((s) => s.id === t.itemId)?.title ?? "Session";
    } else if (t.type === "cron") {
      label = crons.find((c) => c.id === t.itemId)?.name ?? "Cron";
    } else if (t.type === "iterm") {
      const s = itermSessions.find((s) => s.session_id === t.itemId);
      label = s?.aiTitle ?? s?.name ?? "Terminal";
    } else {
      label = "WeChat";
    }
    return { ...t, label };
  });

  return (
    <AppLayout
      sidebar={
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
          crons={crons}
          activeCronId={activeCronId}
          onSelectCron={handleSelectCron}
          onCreateCron={createCron}
          onUpdateCron={updateCron}
          onDeleteCron={handleDeleteCron}
          onTriggerCron={triggerCron}
          onImportSystemCrons={importSystemCrons}
          services={services}
          onStartService={startService}
          onStopService={stopService}
          onRestartService={restartService}
          onDeleteService={deleteService}
          onCreateService={createService}
          onUpdateService={updateService}
          onToggleServiceEnabled={toggleServiceEnabled}
          onGetServiceLogs={getServiceLogs}
          onDiscoverServices={discoverServices}
          itermSessions={itermSessions}
          itermAvailable={itermAvailable}
          activeItermSessionId={activeItermId}
          onSelectItermSession={handleSelectItermSession}
          wechatActive={wechatActive}
          onSelectWeChat={handleSelectWeChat}
          onRefreshAll={() => { refreshCrons(); refreshServices(true); refreshItermSessions(true); }}
        />
      }
    >
      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <TabBar
        tabs={resolvedTabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={closeTab}
      />

      {/* ── Tab contents — ALL mounted, only active one visible ─────────── */}
      <div className="flex-1 min-h-0 relative">
        {tabs.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted">
            <div className="text-center space-y-3">
              <h2 className="text-2xl font-light">CtrlNect</h2>
              <p className="text-sm">Select a session to get started</p>
            </div>
          </div>
        )}

        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0 flex flex-col"
            style={{ display: activeTabId === tab.id ? "flex" : "none" }}
          >
            {tab.type === "session" && (
              <SessionView
                sessionId={tab.itemId}
                session={sessions.find((s) => s.id === tab.itemId) ?? null}
                onUpdateSession={updateSession}
              />
            )}

            {tab.type === "cron" && (() => {
              const cron = crons.find((c) => c.id === tab.itemId);
              return cron ? (
                <CronLogView
                  cron={cron}
                  sessions={sessions}
                  onTrigger={triggerCron}
                  onUpdate={updateCron}
                />
              ) : null;
            })()}

            {tab.type === "iterm" && (() => {
              const s = itermSessions.find((s) => s.session_id === tab.itemId);
              return s ? (
                <ItermView
                  session={s}
                  onGetContent={getItermContent}
                  onSendText={sendItermText}
                />
              ) : null;
            })()}

            {tab.type === "wechat" && <WeChatView />}
          </div>
        ))}
      </div>
    </AppLayout>
  );
}

export function App() {
  return (
    <WSProvider>
      <AppInner />
    </WSProvider>
  );
}
