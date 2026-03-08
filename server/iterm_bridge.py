# /// script
# requires-python = ">=3.10"
# dependencies = ["iterm2", "fastapi", "uvicorn[standard]"]
# ///
"""
iTerm2 Bridge — internal subprocess for ctrlnect
Binds to 127.0.0.1:$PORT (default 8765), no auth (internal use only).

Endpoints:
  GET  /sessions
  GET  /session/{id}/content?lines=N
  POST /session/{id}/send          body: {"text": "..."}
"""

import asyncio
import os
import sys
import signal
import subprocess
import time
import hashlib
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import iterm2
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── iTerm2 connection ─────────────────────────────────────────────────────────

_conn: Optional[Any] = None
_app: Optional[Any] = None


async def _connect() -> bool:
    global _conn, _app
    try:
        _conn = await iterm2.Connection.async_create()
        _app = await iterm2.async_get_app(_conn)
        return True
    except Exception as e:
        print(f"[iterm-bridge] Could not connect to iTerm2: {e}", flush=True)
        return False


async def _close():
    global _conn, _app
    if _conn is None:
        return
    try:
        task = getattr(_conn, "_receiver_task", None)
        ws = getattr(_conn, "_websocket", None)
        if task:
            task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=1.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        if ws:
            await ws.close()
    except Exception:
        pass
    _conn = None
    _app = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    ok = await _connect()
    if ok:
        sessions = []
        for w in _app.windows:
            for t in w.tabs:
                sessions.extend(t.sessions)
        print(f"[iterm-bridge] Connected — {len(sessions)} session(s)", flush=True)
    yield
    await _close()


bridge = FastAPI(title="CtrlNect iTerm2 Bridge", lifespan=lifespan)
bridge.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def _line_to_string_with_spaces(line: Any) -> str:
    """Reconstruct terminal line text, substituting spaces for empty cells.

    iTerm2's line.string concatenates only non-empty cell strings and silently
    drops the "empty" cells that are visually rendered as spaces.  We iterate
    every column and substitute a real space for each empty cell.
    """
    lengths = getattr(line, "_LineContents__length_of_cell", None)
    if lengths is None:
        return line.string or ""
    result: List[str] = []
    for x in range(len(lengths)):
        try:
            ch = line.string_at(x)
            result.append(ch if ch else " ")
        except Exception:
            result.append(" ")
    return "".join(result).rstrip()


async def _find_session(session_id: str) -> Optional[Any]:
    if _app is None:
        return None
    for w in _app.windows:
        for t in w.tabs:
            for s in t.sessions:
                if s.session_id == session_id:
                    return s
    return None


# ── Routes ────────────────────────────────────────────────────────────────────

@bridge.get("/sessions")
async def list_sessions():
    if _app is None:
        return {"sessions": [], "error": "Not connected to iTerm2"}
    sessions = []
    for window in _app.windows:
        for tab in window.tabs:
            for session in tab.sessions:
                info: Dict[str, Any] = {
                    "session_id": session.session_id,
                    "name": session.name or "Unnamed",
                    "window_id": window.window_id,
                    "tab_id": tab.tab_id,
                }
                var_map = {
                    "jobName": "job_name",
                    "user.current_title": "current_title",
                    "path": "pwd",
                }
                for var, key in var_map.items():
                    try:
                        v = await session.async_get_variable(var)
                        if v:
                            info[key] = v
                    except Exception:
                        pass
                # Shorten home directory to ~ in pwd
                if "pwd" in info:
                    home = os.path.expanduser("~")
                    if info["pwd"].startswith(home):
                        info["pwd"] = "~" + info["pwd"][len(home):]
                sessions.append(info)
    return {"sessions": sessions}


@bridge.get("/session/{session_id}/content")
async def get_content(
    session_id: str,
    lines: int = 120,
    skip_trailing_empty: bool = True,
):
    if _app is None:
        raise HTTPException(503, "Not connected to iTerm2")
    session = await _find_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    requested = _clamp(lines, 10, 2000)

    async with iterm2.Transaction(_conn):
        line_info = await session.async_get_line_info()
        oldest = line_info.overflow
        newest = line_info.overflow + line_info.scrollback_buffer_height + line_info.mutable_area_height
        newest = max(newest, oldest)

        anchor = newest
        if skip_trailing_empty and newest > oldest:
            probe_size = min(max(requested * 6, line_info.mutable_area_height * 2, 200), newest - oldest)
            probe_start = max(oldest, newest - probe_size)
            probe_count = max(0, newest - probe_start)
            probe_lines = await session.async_get_contents(probe_start, probe_count)
            for idx in range(len(probe_lines) - 1, -1, -1):
                if _line_to_string_with_spaces(probe_lines[idx]).strip():
                    anchor = probe_start + idx + 1
                    break

        start = max(oldest, anchor - requested)
        end = min(newest, start + requested)
        count = max(0, end - start)
        fetched = await session.async_get_contents(start, count) if count else []
        screen = await session.async_get_screen_contents()

    text_lines = [_line_to_string_with_spaces(l) for l in fetched]
    width = 80
    try:
        width = screen.windowed_coord_range.columns.length
    except Exception:
        pass

    return {
        "session_id": session_id,
        "content": "\n".join(text_lines),
        "lines": len(text_lines),
        "start_line": start,
        "end_line": end,
        "newest_line": newest,
        "oldest_line": oldest,
        "following_latest": end >= newest,
        "has_older": start > oldest,
        "has_newer": end < newest,
        "columns": width,
        "cursor_x": screen.cursor_coord.x,
        "cursor_y": screen.cursor_coord.y,
    }


class SendTextRequest(BaseModel):
    text: str


@bridge.post("/session/{session_id}/send")
async def send_text(session_id: str, req: SendTextRequest):
    if _app is None:
        raise HTTPException(503, "Not connected to iTerm2")
    session = await _find_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    await session.async_send_text(req.text)
    return {"ok": True, "session_id": session_id}


# ── Entry point ───────────────────────────────────────────────────────────────

def _kill_port(port: int):
    result = subprocess.run(["lsof", "-ti", f":{port}"], capture_output=True, text=True)
    for pid in result.stdout.strip().split():
        try:
            os.kill(int(pid), signal.SIGTERM)
        except Exception:
            pass
    for _ in range(20):
        time.sleep(0.1)
        result = subprocess.run(["lsof", "-ti", f":{port}"], capture_output=True, text=True)
        if not result.stdout.strip():
            return


if __name__ == "__main__":
    port = int(os.environ.get("ITERM_BRIDGE_PORT", "8765"))
    _kill_port(port)
    print(f"[iterm-bridge] Starting on 127.0.0.1:{port}", flush=True)
    uvicorn.run(bridge, host="127.0.0.1", port=port, log_level="warning")
