import type { ChatMessage, ContentBlock } from "@/hooks/use-chat";
import { cn } from "@/lib/utils";
import { TextBlock } from "./text-block";
import { ThinkingBlock } from "./thinking-block";
import { ToolUseBlock } from "./tool-use-block";
import { ToolResultBlock } from "./tool-result-block";
import { ImageBlock } from "./image-block";

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming: boolean;
  childMessages?: ChatMessage[];
}

export function MessageBubble({
  message,
  isStreaming,
  childMessages = [],
}: MessageBubbleProps) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end msg-enter">
        <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-md bg-bg-user border border-border/60 text-text-primary text-[0.9rem] leading-relaxed whitespace-pre-wrap">
          {message.blocks.map((block, i) =>
            block.type === "text" ? (
              <span key={i}>{block.text}</span>
            ) : block.type === "image" ? (
              <ImageBlock
                key={i}
                src={`data:${block.source.media_type};base64,${block.source.data}`}
              />
            ) : null,
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="msg-enter">
      <div className="space-y-2">
        {message.blocks.map((block, i) => (
          <BlockRenderer
            key={i}
            block={block}
            isStreaming={isStreaming && i === message.blocks.length - 1}
          />
        ))}

        {childMessages.length > 0 && (
          <div className="ml-3 pl-3 border-l border-border/50 space-y-2">
            {childMessages.map((child) => (
              <MessageBubble
                key={child.id}
                message={child}
                isStreaming={false}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BlockRenderer({
  block,
  isStreaming,
}: {
  block: ContentBlock;
  isStreaming: boolean;
}) {
  switch (block.type) {
    case "text":
      return <TextBlock text={block.text} isStreaming={isStreaming} />;
    case "thinking":
      return <ThinkingBlock text={block.text} />;
    case "tool_use":
      return <ToolUseBlock name={block.name} input={block.input} />;
    case "tool_result":
      return (
        <ToolResultBlock content={block.content} isError={block.isError} />
      );
    case "image":
      return (
        <ImageBlock
          src={`data:${block.source.media_type};base64,${block.source.data}`}
        />
      );
  }
}
