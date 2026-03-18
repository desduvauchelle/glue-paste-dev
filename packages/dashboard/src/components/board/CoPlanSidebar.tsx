import { useState, useRef, useEffect, useCallback } from "react";
import type { CardWithTags, Comment } from "@/lib/api";
import { useChat } from "@/hooks/use-chat";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { X, Send, Square, Brain, Zap, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface CoPlanSidebarProps {
  card: CardWithTags;
  onClose: () => void;
}

export function CoPlanSidebar({ card, onClose }: CoPlanSidebarProps) {
  const [mode, setMode] = useState<"plan" | "execute">("plan");
  const [thinking, setThinking] = useState<"smart" | "basic">("smart");
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, isStreaming, streamingContent, send, stop, loadMessages } = useChat({
    cardId: card.id,
  });

  // Load messages when card changes
  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    await send(trimmed, mode, thinking);
  }, [input, isStreaming, send, mode, thinking]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // Filter to show only user/ai comments (not system)
  const chatMessages = messages.filter((m) => m.author === "user" || m.author === "ai");

  return (
    <div className="w-[450px] shrink-0 border-l border-border flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-semibold truncate">{card.title}</h3>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Mode & Model toggles */}
      <div className="border-b border-border px-4 py-2 flex items-center gap-3 shrink-0">
        {/* Mode toggle */}
        <div className="flex rounded-md border border-border overflow-hidden text-xs">
          <button
            type="button"
            className={cn(
              "px-3 py-1 transition-colors",
              mode === "plan" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            )}
            onClick={() => setMode("plan")}
          >
            Plan
          </button>
          <button
            type="button"
            className={cn(
              "px-3 py-1 transition-colors border-l border-border",
              mode === "execute" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            )}
            onClick={() => setMode("execute")}
          >
            Execute
          </button>
        </div>

        {/* Model toggle */}
        <div className="flex rounded-md border border-border overflow-hidden text-xs">
          <button
            type="button"
            className={cn(
              "px-2.5 py-1 flex items-center gap-1 transition-colors",
              thinking === "smart" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            )}
            onClick={() => setThinking("smart")}
            title="Claude Opus (Smart)"
          >
            <Brain className="w-3 h-3" />
            Smart
          </button>
          <button
            type="button"
            className={cn(
              "px-2.5 py-1 flex items-center gap-1 transition-colors border-l border-border",
              thinking === "basic" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            )}
            onClick={() => setThinking("basic")}
            title="Claude Sonnet (Basic)"
          >
            <Zap className="w-3 h-3" />
            Basic
          </button>
        </div>
      </div>

      {/* Chat messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div ref={scrollRef} className="p-4 space-y-3">
          {chatMessages.length === 0 && !isStreaming && (
            <div className="text-center text-muted-foreground text-sm py-8">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>Start a conversation to co-plan this card.</p>
              <p className="text-xs mt-1 opacity-70">
                Use <strong>Plan</strong> mode to analyze and discuss, or <strong>Execute</strong> mode to make changes.
              </p>
            </div>
          )}

          {chatMessages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}

          {/* Streaming AI response */}
          {isStreaming && streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-muted whitespace-pre-wrap break-words">
                {streamingContent}
              </div>
            </div>
          )}

          {/* Typing indicator */}
          {isStreaming && !streamingContent && (
            <div className="flex justify-start">
              <div className="rounded-lg px-3 py-2 bg-muted">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === "plan" ? "Discuss the plan..." : "Describe what to implement..."}
            className="min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button
              variant="destructive"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={() => void stop()}
            >
              <Square className="w-4 h-4 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-10 w-10 shrink-0"
              disabled={!input.trim()}
              onClick={() => void handleSend()}
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ message }: { message: Comment }) {
  const isUser = message.author === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        )}
      >
        {message.content}
      </div>
    </div>
  );
}
