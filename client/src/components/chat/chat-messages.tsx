import type { ChatMessage } from "@/hooks/use-chat";
import { MessageBubble } from "./message-bubble";

interface ChatMessagesProps {
  messages: ChatMessage[];
  streaming: boolean;
}

export function ChatMessages({ messages, streaming }: ChatMessagesProps) {
  const topLevel = messages.filter((m) => m.parentToolUseId === null);

  return (
    <div className="space-y-5">
      {topLevel.map((msg, i) => {
        const isLast =
          i === topLevel.length - 1 && msg.role === "assistant";
        return (
          <MessageBubble
            key={msg.id}
            message={msg}
            isStreaming={isLast && streaming}
            childMessages={messages.filter(
              (m) =>
                m.parentToolUseId !== null &&
                msg.blocks.some(
                  (b) =>
                    b.type === "tool_use" && b.id === m.parentToolUseId,
                ),
            )}
          />
        );
      })}
    </div>
  );
}
