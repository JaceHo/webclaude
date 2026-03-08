import { Trash2, Circle } from "lucide-react";
import type { Session } from "@ctrlnect/shared";
import { cn, formatTime, truncate } from "@/lib/utils";
import { FeishuIcon } from "@/components/icons/feishu-icon";

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
}: SessionItemProps) {
  const isFeishu = !!session.feishuDmInfo;

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex items-start gap-2 px-3 py-2 mx-1 rounded-lg cursor-pointer transition-colors",
        isActive ? "bg-bg-tertiary" : "hover:bg-bg-hover",
      )}
    >
      {/* Status indicator – Feishu sessions use the brand icon; regular ones a dot */}
      {isFeishu ? (
        <span className="mt-[3px] flex-shrink-0 relative">
          <FeishuIcon size={13} />
          {/* Small pulse dot overlay when running */}
          {session.status === "running" && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-running pulse-dot" />
          )}
          {session.status === "error" && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
          )}
        </span>
      ) : (
        <Circle
          size={6}
          className={cn(
            "mt-1.5 flex-shrink-0",
            session.status === "running" && "fill-running text-running pulse-dot",
            session.status === "idle" && "fill-text-muted text-text-muted",
            session.status === "error" && "fill-red-500 text-red-500",
          )}
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <div className="text-sm truncate font-medium">
            {isFeishu ? truncate(session.title, 22) : (session.cwd.split("/").pop() || session.cwd)}
          </div>
          <span className="text-[10px] text-text-muted flex-shrink-0">
            {formatTime(session.lastActivity)}
          </span>
        </div>
        <div className="text-xs text-text-muted mt-0.5 truncate">
          {isFeishu ? (
            <span className="text-[#00B2B2]">
              Feishu DM
              {session.feishuDmInfo?.autoReply && <span className="opacity-60 ml-1">auto</span>}
            </span>
          ) : (
            <span title={session.title}>{truncate(session.title, 32)}</span>
          )}
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-red-400 transition-all"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
