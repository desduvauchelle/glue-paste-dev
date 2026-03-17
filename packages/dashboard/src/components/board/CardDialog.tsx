import { useState, useEffect } from "react";
import type { CardWithTags, CreateCard, UpdateCard } from "@/lib/api";
import { tags as tagsApi } from "@/lib/api";
import { useComments } from "@/hooks/use-comments";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, X, Play, Trash2, Plus, Eraser, Brain, Zap } from "lucide-react";

interface CardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: CardWithTags | null;
  boardId: string;
  onCreate: (input: CreateCard) => Promise<unknown>;
  onUpdate: (id: string, input: UpdateCard) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onPlay: (id: string) => void;
}

export function CardDialog({
  open,
  onOpenChange,
  card,
  boardId: _boardId,
  onCreate,
  onUpdate,
  onDelete,
  onPlay,
}: CardDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState("");
  const [blocking, setBlocking] = useState(true);
  const [thinkingLevel, setThinkingLevel] = useState<"smart" | "basic" | null>(null);
  const [planMode, setPlanMode] = useState<boolean | null>(null);
  const [commentText, setCommentText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { comments, add: addComment, clear: clearComments } = useComments(card?.id ?? null);

  const isEditing = card !== null;

  useEffect(() => {
    if (card) {
      setTitle(card.title);
      setDescription(card.description);
      setSelectedTags(card.tags);
      setBlocking(card.blocking);
      setThinkingLevel(card.thinking_level);
      setPlanMode(card.plan_mode);
    } else {
      setTitle("");
      setDescription("");
      setSelectedTags([]);
      setBlocking(false);
      setThinkingLevel(null);
      setPlanMode(null);
    }
    setConfirmDelete(false);
    setCustomTagInput("");
  }, [card, open]);

  useEffect(() => {
    void tagsApi.defaults().then(setAvailableTags);
  }, []);

  // Merge available tags with any custom tags already on the card
  const allTags = [...new Set([...availableTags, ...selectedTags])];

  const handleSave = async () => {
    if (!title.trim()) return;
    if (isEditing) {
      await onUpdate(card.id, {
        title: title.trim(),
        description: description.trim(),
        tags: selectedTags,
        blocking,
        thinking_level: thinkingLevel,
        plan_mode: planMode,
      });
    } else {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        tags: selectedTags,
        blocking,
        thinking_level: thinkingLevel,
        plan_mode: planMode,
      });
    }
    onOpenChange(false);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const addCustomTag = () => {
    const tag = customTagInput.trim();
    if (!tag) return;
    if (!selectedTags.includes(tag)) {
      setSelectedTags((prev) => [...prev, tag]);
    }
    if (!availableTags.includes(tag)) {
      setAvailableTags((prev) => [...prev, tag]);
    }
    setCustomTagInput("");
  };

  const handleDelete = async () => {
    if (!isEditing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await onDelete(card.id);
    onOpenChange(false);
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    await addComment(commentText.trim());
    setCommentText("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Card" : "New Card"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-y-auto py-2">
          {/* Title */}
          <div>
            <label className="text-sm font-medium mb-1 block">Title</label>
            <Input
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium mb-1 block">Description</label>
            <Textarea
              placeholder="Describe what needs to be done..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[100px]"
            />
          </div>

          {/* Blocking checkbox */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="blocking"
              checked={blocking}
              onChange={(e) => setBlocking(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-background accent-primary"
            />
            <label htmlFor="blocking" className="text-sm font-medium cursor-pointer">
              Blocking
            </label>
            <span className="text-xs text-muted-foreground">
              — If checked, Play All will stop if this card fails
            </span>
          </div>

          {/* Thinking Level */}
          <div>
            <label className="text-sm font-medium mb-1 block">Thinking Level</label>
            <div className="flex gap-2">
              {([null, "smart", "basic"] as const).map((level) => (
                <Button
                  key={level ?? "default"}
                  type="button"
                  size="sm"
                  variant={thinkingLevel === level ? "default" : "outline"}
                  onClick={() => setThinkingLevel(level)}
                  className="flex items-center gap-1.5"
                >
                  {level === null && "Default"}
                  {level === "smart" && <><Brain className="w-3.5 h-3.5" /> Smart (Opus)</>}
                  {level === "basic" && <><Zap className="w-3.5 h-3.5" /> Basic (Sonnet)</>}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {thinkingLevel === null
                ? "Uses the project or global default"
                : thinkingLevel === "smart"
                  ? "Uses Opus for deeper reasoning"
                  : "Uses Sonnet for faster, simpler tasks"}
            </p>
          </div>

          {/* Plan Mode */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="plan-mode"
              checked={planMode === null ? false : planMode}
              ref={(el) => {
                if (el) el.indeterminate = planMode === null;
              }}
              onChange={() => {
                if (planMode === null) setPlanMode(true);
                else if (planMode) setPlanMode(false);
                else setPlanMode(null);
              }}
              className="h-4 w-4 rounded border-border bg-background accent-primary"
            />
            <label htmlFor="plan-mode" className="text-sm font-medium cursor-pointer">
              Plan Mode
            </label>
            <span className="text-xs text-muted-foreground">
              — {planMode === null ? "Default (uses project setting)" : planMode ? "Plan then execute" : "Execute directly"}
            </span>
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium mb-1 block">Tags</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {allTags.map((tag) => (
                <Badge
                  key={tag}
                  variant={selectedTags.includes(tag) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                  {selectedTags.includes(tag) && <X className="w-3 h-3 ml-1" />}
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Add custom tag..."
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomTag();
                  }
                }}
                className="flex-1"
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={addCustomTag}
                disabled={!customTagInput.trim()}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Comments (only when editing) */}
          {isEditing && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">
                  Comments ({comments.length})
                </label>
                {comments.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => void clearComments()}
                    title="Clear all comments"
                  >
                    <Eraser className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
              <ScrollArea className="max-h-[200px] border rounded-md p-2">
                {comments.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">
                    No comments yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {comments.map((comment) => (
                      <div
                        key={comment.id}
                        className="text-xs border-l-2 pl-2 border-border"
                      >
                        <span className="font-semibold capitalize text-muted-foreground">
                          {comment.author}
                        </span>
                        <span className="text-muted-foreground/60 ml-2">
                          {new Date(comment.created_at).toLocaleString()}
                        </span>
                        <p className="mt-0.5 whitespace-pre-wrap">{comment.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
              <div className="flex gap-2 mt-2">
                <Input
                  placeholder="Add a comment..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleAddComment();
                    }
                  }}
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => void handleAddComment()}
                  disabled={!commentText.trim()}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {isEditing && (
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              className="mr-auto"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              {confirmDelete ? "Confirm Delete" : "Delete"}
            </Button>
          )}
          {isEditing && card.status === "todo" && (
            <Button
              variant="outline"
              onClick={() => {
                onPlay(card.id);
                onOpenChange(false);
              }}
            >
              <Play className="w-4 h-4 mr-2" />
              Execute
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!title.trim()}>
            {isEditing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
