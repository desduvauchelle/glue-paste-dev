import { useState, useRef, useEffect, useCallback } from "react";
import type { CardWithTags, Comment } from "@/lib/api";
import { cards as cardsApi, chat as chatApi, comments as commentsApi } from "@/lib/api";
import { useWebSocket } from "@/lib/ws";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { X, Send, Square, Brain, Zap, Lightbulb, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";
import { cardLabel } from "@glue-paste-dev/core/browser";

interface BrainstormPanelProps {
  /** Existing card to brainstorm on, or null for a fresh brainstorm */
  card: CardWithTags | null;
  boardId: string;
  onClose: () => void;
  /** Called when a card is created from the brainstorm */
  onCardCreated?: (card: CardWithTags) => void;
}

export function BrainstormPanel({
  card: initialCard,
  boardId,
  onClose,
  onCardCreated,
}: BrainstormPanelProps) {
  const [thinking, setThinking] = useState<"smart" | "basic">("smart");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Comment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const streamingRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tempCard, setTempCard] = useState<CardWithTags | null>(initialCard);
  const [creating, setCreating] = useState(false);
  const tempCardRef = useRef(tempCard);
  tempCardRef.current = tempCard;

  // Is this a fresh brainstorm (no existing card)?
  const isFreshBrainstorm = initialCard === null;

  // Load messages when we have a card
  useEffect(() => {
    if (tempCard) {
      void commentsApi.list(tempCard.id).then((all) => {
        setMessages(all.filter((m) => m.author === "user" || m.author === "ai"));
      });
    }
  }, [tempCard?.id]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  // Focus textarea
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // WebSocket events
  useWebSocket((event) => {
    const card = tempCardRef.current;
    if (!card) return;

    if (event.type === "chat:output") {
      const payload = event.payload as { cardId: string; chunk: string };
      if (payload.cardId === card.id) {
        streamingRef.current += payload.chunk;
        setStreamingContent(streamingRef.current);
      }
    }
    if (event.type === "chat:completed") {
      const payload = event.payload as { cardId: string };
      if (payload.cardId === card.id) {
        setIsStreaming(false);
        setStreamingContent("");
        streamingRef.current = "";
        void commentsApi.list(card.id).then((all) => {
          setMessages(all.filter((m) => m.author === "user" || m.author === "ai"));
        });
      }
    }
    if (event.type === "comment:added") {
      const comment = event.payload as Comment;
      if (comment.card_id === card.id && (comment.author === "user" || comment.author === "ai")) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === comment.id)) return prev;
          return [...prev, comment];
        });
      }
    }
  });

  const ensureCard = useCallback(async (): Promise<CardWithTags> => {
    if (tempCard) return tempCard;

    // Create a temporary card for this brainstorm session
    const created = await cardsApi.create(boardId, {
      title: "",
      description: "",
      status: "todo",
      plan_thinking: "none",
    });
    setTempCard(created);
    return created;
  }, [tempCard, boardId]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    setIsStreaming(true);
    setStreamingContent("");
    streamingRef.current = "";

    const card = await ensureCard();
    await chatApi.send(card.id, { message: trimmed, mode: "plan", thinking });
  }, [input, isStreaming, ensureCard, thinking]);

  const handleStop = useCallback(async () => {
    if (!tempCard) return;
    await chatApi.stop(tempCard.id);
    setIsStreaming(false);
    setStreamingContent("");
    streamingRef.current = "";
  }, [tempCard]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleCreateCard = useCallback(async () => {
    if (!tempCard || messages.length === 0) return;
    setCreating(true);

    // Build a description from the conversation
    const conversationSummary = messages
      .map((m) => `**${m.author === "user" ? "User" : "AI"}:** ${m.content}`)
      .join("\n\n---\n\n");

    // Extract a title from the first user message
    const firstUserMsg = messages.find((m) => m.author === "user");
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 100) + (firstUserMsg.content.length > 100 ? "..." : "")
      : "Brainstorm";

    // Get the last AI message as the plan/description
    const lastAiMsg = [...messages].reverse().find((m) => m.author === "ai");
    const description = lastAiMsg ? lastAiMsg.content : conversationSummary;

    if (isFreshBrainstorm) {
      // Update the temp card with title, description, and queue it
      await cardsApi.update(tempCard.id, {
        title,
        description,
        status: "queued",
        plan_thinking: "none",
      });
    } else {
      // Existing card — update description with brainstorm output and queue
      const existingDesc = tempCard.description ? tempCard.description + "\n\n---\n\n## Brainstorm Output\n\n" : "";
      await cardsApi.update(tempCard.id, {
        description: existingDesc + description,
        status: "queued",
        plan_thinking: "none",
      });
    }

    // Refetch the updated card
    const updated = await cardsApi.get(tempCard.id);
    onCardCreated?.(updated);
    setCreating(false);
    onClose();
  }, [tempCard, messages, isFreshBrainstorm, onCardCreated, onClose]);

  const handleDiscardAndClose = useCallback(async () => {
    // If it was a fresh brainstorm with a temp card that has no real content, delete it
    if (isFreshBrainstorm && tempCard && messages.length === 0) {
      try {
        await cardsApi.delete(tempCard.id);
      } catch {
        // ignore
      }
    }
    onClose();
  }, [isFreshBrainstorm, tempCard, messages.length, onClose]);

  const chatMessages = messages;
  const hasConversation = chatMessages.length > 0;

  return (
    <div className="w-[450px] shrink-0 border-l border-border flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Lightbulb className="w-4 h-4 text-amber-400 shrink-0" />
          <h3 className="text-sm font-semibold truncate">
            {initialCard ? cardLabel(initialCard) : "Brainstorm"}
          </h3>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => void handleDiscardAndClose()}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Thinking toggle */}
      <div className="border-b border-border px-4 py-2 flex items-center gap-3 shrink-0">
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
        <span className="text-xs text-muted-foreground">Plan mode</span>
      </div>

      {/* Chat messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div ref={scrollRef} className="p-4 space-y-3">
          {chatMessages.length === 0 && !isStreaming && (
            <div className="text-center text-muted-foreground text-sm py-8">
              <Lightbulb className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>Brainstorm your idea here.</p>
              <p className="text-xs mt-1 opacity-70">
                Discuss the feature, plan the implementation, then create a card to execute it.
              </p>
            </div>
          )}

          {chatMessages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}

          {isStreaming && streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-muted break-words">
                <Markdown>{streamingContent}</Markdown>
              </div>
            </div>
          )}

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

      {/* Input + Action buttons */}
      <div className="border-t border-border p-3 shrink-0 space-y-2">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your idea or ask a question..."
            className="min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button
              variant="destructive"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={() => void handleStop()}
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

        {/* Create Card button — visible once there's conversation */}
        {hasConversation && !isStreaming && (
          <Button
            className="w-full"
            onClick={() => void handleCreateCard()}
            disabled={creating}
          >
            <Play className="w-4 h-4 mr-2" />
            {creating ? "Creating..." : "Create Card & Queue"}
          </Button>
        )}
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
          "max-w-[85%] rounded-lg px-3 py-2 text-sm break-words",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        )}
      >
        <Markdown>{message.content}</Markdown>
      </div>
    </div>
  );
}
