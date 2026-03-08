/**
 * System crontab integration.
 * Manages a "ctrlnect-managed" section of the user's personal crontab.
 * Each managed entry is tagged with a comment line:  # ctrlnect:<cronId>
 */

import type { CronJob } from "@ctrlnect/shared";

const TAG_PREFIX = "# ctrlnect:";

export interface SystemCrontabEntry {
  schedule: string;   // 5-field cron expression
  command: string;    // shell command
  rawLine: string;    // original unparsed line
}

/** Run `crontab -l` and return the full text (empty string if none/error). */
async function readRaw(): Promise<string> {
  try {
    const proc = Bun.spawn(["crontab", "-l"], { stdout: "pipe", stderr: "pipe" });
    // Consume both stdout and stderr concurrently to prevent pipe-buffer hangs
    const [text] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(), // discard stderr ("no crontab for user" etc.)
    ]);
    await proc.exited;
    return text;
  } catch {
    return "";
  }
}

/** Write a full crontab text via `crontab -`. */
async function writeRaw(content: string): Promise<void> {
  const proc = Bun.spawn(["crontab", "-"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin!.write(content);
  proc.stdin!.end();
  const [exit, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);
  if (exit !== 0) {
    throw new Error(`crontab write failed (exit ${exit}): ${stderr.trim()}`);
  }
}

/**
 * Parse the current user crontab and return entries that are NOT managed by CtrlNect.
 * This is the "user's own" crontab lines we should never touch.
 */
export async function readUnmanagedLines(): Promise<string[]> {
  const raw = await readRaw();
  const lines = raw.split("\n");
  const out: string[] = [];
  let skipNext = false;

  for (const line of lines) {
    if (line.startsWith(TAG_PREFIX)) {
      // This is our tag comment — the *next* line is the managed entry; skip both
      skipNext = true;
      continue;
    }
    if (skipNext) {
      skipNext = false;
      continue;
    }
    out.push(line);
  }

  // Remove trailing empty lines added by stripping
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();

  return out;
}

/**
 * Parse crontab entries that ARE managed by CtrlNect (tagged).
 * Returns a map of cronId -> schedule+command text.
 */
export async function readManagedEntries(): Promise<Map<string, { schedule: string; command: string }>> {
  const raw = await readRaw();
  const lines = raw.split("\n");
  const result = new Map<string, { schedule: string; command: string }>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(TAG_PREFIX)) {
      const cronId = line.slice(TAG_PREFIX.length).trim();
      const entry = lines[i + 1]?.trim();
      if (entry && cronId) {
        const parts = entry.split(/\s+/);
        if (parts.length >= 6) {
          result.set(cronId, {
            schedule: parts.slice(0, 5).join(" "),
            command: parts.slice(5).join(" "),
          });
        }
      }
    }
  }

  return result;
}

/**
 * Read all "user-owned" (non-managed) crontab entries for the import UI.
 */
export async function readImportableEntries(): Promise<SystemCrontabEntry[]> {
  const raw = await readRaw();
  const lines = raw.split("\n");
  const result: SystemCrontabEntry[] = [];
  let skipNext = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip our tag comments and the lines they annotate
    if (trimmed.startsWith(TAG_PREFIX)) { skipNext = true; continue; }
    if (skipNext) { skipNext = false; continue; }

    // Skip comments, environment variable assignments, and empty lines
    if (!trimmed || trimmed.startsWith("#") || /^\w+=/.test(trimmed)) continue;

    // Try to parse as a 5-field cron expression
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 6) {
      result.push({
        schedule: parts.slice(0, 5).join(" "),
        command: parts.slice(5).join(" "),
        rawLine: trimmed,
      });
    }
  }

  return result;
}

/**
 * Sync all enabled command-type crons back to the system crontab.
 * Preserves all user-owned lines unchanged.
 */
export async function syncCommandCrons(commandCrons: CronJob[]): Promise<void> {
  const unmanagedLines = await readUnmanagedLines();

  const managedLines: string[] = [];
  for (const cron of commandCrons) {
    if (!cron.enabled) continue;
    managedLines.push(`${TAG_PREFIX}${cron.id}`);
    managedLines.push(`${cron.schedule} ${cron.prompt}`);
  }

  const allLines = [...unmanagedLines, ...(managedLines.length ? ["", ...managedLines] : []), ""];
  await writeRaw(allLines.join("\n"));
}

/**
 * Execute a shell command and return { output, exitCode }.
 */
export async function runShellCommand(command: string): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn(["sh", "-c", command], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const output = [stdout, stderr ? `STDERR:\n${stderr}` : ""].filter(Boolean).join("\n").trim();
  return { output, exitCode };
}
