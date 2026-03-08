import { useState, useEffect, useCallback } from "react";
import type { CronJob, CreateCronRequest, UpdateCronRequest } from "@ctrlnect/shared";
import { useWS, useWSListener } from "./use-websocket";
import { API_BASE } from "../api";

export function useCrons() {
  const [crons, setCrons] = useState<CronJob[]>([]);
  const ws = useWS();

  const fetchCrons = useCallback(() => {
    fetch(`${API_BASE}/api/crons`)
      .then((r) => r.json())
      .then((data) => setCrons(data))
      .catch(() => {});
  }, []);

  // Fetch on mount
  useEffect(() => { fetchCrons(); }, [fetchCrons]);

  // Re-fetch whenever the WebSocket reconnects (server restart recovery)
  useEffect(() => ws.onConnect(fetchCrons), [ws, fetchCrons]);

  useWSListener(
    useCallback((msg: { type: string; cron?: CronJob; crons?: CronJob[] }) => {
      if (msg.type === "cron_update" && msg.cron) {
        setCrons((prev) => {
          const idx = prev.findIndex((c) => c.id === msg.cron!.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = msg.cron!;
            return next;
          }
          return [msg.cron!, ...prev];
        });
      } else if (msg.type === "cron_list" && msg.crons) {
        setCrons(msg.crons);
      }
    }, []),
  );

  const createCron = useCallback(async (req: CreateCronRequest) => {
    const res = await fetch(`${API_BASE}/api/crons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return (await res.json()) as CronJob;
  }, []);

  const updateCron = useCallback(async (id: string, req: UpdateCronRequest) => {
    const res = await fetch(`/api/crons/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return (await res.json()) as CronJob;
  }, []);

  const deleteCron = useCallback(async (id: string) => {
    const res = await fetch(`/api/crons/${id}`, { method: "DELETE" });
    if (res.ok) {
      // Optimistic update + force re-fetch to confirm server state
      setCrons((prev) => prev.filter((c) => c.id !== id));
      fetchCrons();
    }
  }, [fetchCrons]);

  const triggerCron = useCallback(async (id: string) => {
    await fetch(`/api/crons/${id}/trigger`, { method: "POST" });
  }, []);

  const importSystemCrons = useCallback(async (): Promise<{ imported: number }> => {
    const res = await fetch(`${API_BASE}/api/crons/import-system`, { method: "POST" });
    const result = await res.json() as { imported: number; crons?: CronJob[] };
    if (result.crons?.length) {
      setCrons((prev) => {
        const newIds = new Set(result.crons!.map((c) => c.id));
        return [...prev.filter((c) => !newIds.has(c.id)), ...result.crons!];
      });
    }
    return { imported: result.imported };
  }, []);

  return { crons, createCron, updateCron, deleteCron, triggerCron, importSystemCrons, refreshCrons: fetchCrons };
}
