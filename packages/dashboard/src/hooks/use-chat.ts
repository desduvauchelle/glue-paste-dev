import { useState, useCallback, useRef } from "react";
import { comments as commentsApi, chat as chatApi, type Comment } from "@/lib/api";
import { useWebSocket } from "@/lib/ws";

interface UseChatOptions {
  cardId: string;
}

interface UseChatReturn {
  messages: Comment[];
  isStreaming: boolean;
  streamingContent: string;
  send: (content: string, mode: "plan" | "execute", thinking: "smart" | "basic") => Promise<void>;
  stop: () => Promise<void>;
  loadMessages: () => Promise<void>;
}

export function useChat({ cardId }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Comment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const streamingRef = useRef("");

  const loadMessages = useCallback(async () => {
    const all = await commentsApi.list(cardId);
    setMessages(all);
  }, [cardId]);

  // Listen for WebSocket events
  useWebSocket((event) => {
    if (event.type === "chat:output") {
      const payload = event.payload as { cardId: string; chunk: string };
      if (payload.cardId === cardId) {
        streamingRef.current += payload.chunk;
        setStreamingContent(streamingRef.current);
      }
    }
    if (event.type === "chat:completed") {
      const payload = event.payload as { cardId: string; commentId: string };
      if (payload.cardId === cardId) {
        setIsStreaming(false);
        setStreamingContent("");
        streamingRef.current = "";
        // Reload all comments to get the final saved AI comment
        void commentsApi.list(cardId).then(setMessages);
      }
    }
    if (event.type === "comment:added") {
      const comment = event.payload as Comment;
      if (comment.card_id === cardId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === comment.id)) return prev;
          return [...prev, comment];
        });
      }
    }
  });

  const send = useCallback(async (content: string, mode: "plan" | "execute", thinking: "smart" | "basic") => {
    setIsStreaming(true);
    setStreamingContent("");
    streamingRef.current = "";
    await chatApi.send(cardId, { message: content, mode, thinking });
  }, [cardId]);

  const stop = useCallback(async () => {
    await chatApi.stop(cardId);
    setIsStreaming(false);
    setStreamingContent("");
    streamingRef.current = "";
  }, [cardId]);

  return { messages, isStreaming, streamingContent, send, stop, loadMessages };
}
