import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { ChatMessage } from "@/hooks/use-chat";
import { ChatMessages } from "./chat-messages";

interface ChatContainerProps {
  messages: ChatMessage[];
  streaming: boolean;
}

export function ChatContainer({ messages, streaming }: ChatContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const userScrolledUp = useRef(false);

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      userScrolledUp.current = false;
    }
  };

  useEffect(() => {
    if (streaming && !userScrolledUp.current) {
      scrollToBottom();
    }
  }, [messages, streaming]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      userScrolledUp.current = !atBottom;
      setShowScrollBtn(!atBottom);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <div className="text-center space-y-1">
          <p className="text-lg font-light">What can I help you with?</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto relative" ref={containerRef}>
      <div className="max-w-3xl mx-auto px-6 py-6">
        <ChatMessages messages={messages} streaming={streaming} />
      </div>

      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 p-2 rounded-full bg-bg-tertiary/90 border border-border text-text-secondary hover:text-text-primary backdrop-blur-sm transition-all hover:scale-105"
        >
          <ArrowDown size={14} />
        </button>
      )}
    </div>
  );
}
