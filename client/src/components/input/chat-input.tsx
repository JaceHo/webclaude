import { useState, useRef, useEffect } from "react";
import { Send, Square, ImagePlus } from "lucide-react";
import type { ImageData } from "@webclaude/shared";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (text: string, images?: ImageData[]) => void;
  onInterrupt: () => void;
  streaming: boolean;
  disabled: boolean;
}

export function ChatInput({
  onSend,
  onInterrupt,
  streaming,
  disabled,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ImageData[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [text]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim(), images.length > 0 ? images : undefined);
    setText("");
    setImages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (streaming) return;
      handleSubmit();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          setImages((prev) => [
            ...prev,
            { base64, mediaType: file.type as ImageData["mediaType"] },
          ]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    for (const file of e.dataTransfer.files) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        setImages((prev) => [
          ...prev,
          { base64, mediaType: file.type as ImageData["mediaType"] },
        ]);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="bg-bg-primary px-4 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        {images.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {images.map((img, i) => (
              <div key={i} className="relative group">
                <img
                  src={`data:${img.mediaType};base64,${img.base64}`}
                  alt="Upload"
                  className="h-14 w-14 object-cover rounded-lg border border-border"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className="flex items-end gap-2 rounded-2xl bg-bg-secondary border border-border px-4 py-3 focus-within:border-border-light transition-colors"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <label className="cursor-pointer p-0.5 text-text-muted hover:text-text-secondary transition-colors">
            <ImagePlus size={18} />
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                for (const file of e.target.files || []) {
                  const reader = new FileReader();
                  reader.onload = () => {
                    const base64 = (reader.result as string).split(",")[1];
                    setImages((prev) => [
                      ...prev,
                      { base64, mediaType: file.type as ImageData["mediaType"] },
                    ]);
                  };
                  reader.readAsDataURL(file);
                }
                e.target.value = "";
              }}
            />
          </label>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Message..."
            rows={1}
            className="flex-1 bg-transparent resize-none text-[0.9rem] focus:outline-none placeholder:text-text-muted min-h-[24px] max-h-[200px] py-0.5 leading-relaxed"
            disabled={disabled}
          />

          {streaming ? (
            <button
              onClick={onInterrupt}
              className="p-1.5 rounded-lg text-text-muted hover:text-red-400 transition-colors"
            >
              <Square size={18} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!text.trim() || disabled}
              className={cn(
                "p-1.5 rounded-lg transition-all",
                text.trim() && !disabled
                  ? "text-accent hover:text-accent-hover"
                  : "text-text-muted/40",
              )}
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
