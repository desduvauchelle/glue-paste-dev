import { useState, useEffect } from "react";
import type { Board } from "@/lib/api";
import { boards as boardsApi } from "@/lib/api";
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

interface BoardSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: Board;
  onUpdated: (board: Board) => void;
}

export function BoardSettingsDialog({
  open,
  onOpenChange,
  board,
  onUpdated,
}: BoardSettingsDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [directory, setDirectory] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (board) {
      setName(board.name);
      setDescription(board.description);
      setDirectory(board.directory);
    }
  }, [board, open]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const updated = await boardsApi.update(board.id, {
        name: name.trim(),
        description: description.trim(),
        directory: directory.trim(),
      });
      onUpdated(updated);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Board Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Name</label>
            <Input
              placeholder="Board name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Description</label>
            <Textarea
              placeholder="What is this project about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[80px]"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Project Directory</label>
            <Input
              placeholder="/path/to/project"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              The directory where Claude CLI will execute tasks
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!name.trim() || saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
