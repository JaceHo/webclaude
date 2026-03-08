import { ExternalLink, RefreshCw } from "lucide-react";
import { useRef } from "react";

const WECHAT_URL = "https://wx.qq.com/";

export function WeChatView() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Soft-reload: tells the iframe's own window to refresh, preserving all
  // WeChat session cookies. Never use key changes — that destroys the DOM node
  // and kills the session exactly like closing the tab.
  const handleRefresh = () => {
    try {
      iframeRef.current?.contentWindow?.location.reload();
    } catch {
      // Cross-origin guard fired (shouldn't happen for wx.qq.com, but be safe)
      iframeRef.current?.setAttribute("src", WECHAT_URL);
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <header className="h-11 border-b border-border bg-bg-primary flex items-center px-4 gap-3 flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
        <span className="text-sm font-medium text-text-primary">WeChat Web</span>
        <span className="text-xs text-text-muted font-mono flex-1 truncate">{WECHAT_URL}</span>
        <button
          onClick={handleRefresh}
          className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          title="Reload (preserves login)"
        >
          <RefreshCw size={14} />
        </button>
        <a
          href={WECHAT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          title="Open in browser"
        >
          <ExternalLink size={14} />
        </a>
      </header>

      {/* Iframe — no sandbox so WeChat CDN cookies (avatars, etc.) work fully */}
      <div className="flex-1 relative min-h-0">
        <iframe
          ref={iframeRef}
          src={WECHAT_URL}
          className="w-full h-full border-0"
          title="WeChat Web"
          allow="clipboard-read; clipboard-write; microphone; camera; storage-access"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  );
}
