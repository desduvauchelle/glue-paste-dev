import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Folder, ChevronUp, Check } from "lucide-react";

interface DirectoryPickerProps {
  value: string;
  onChange: (path: string) => void;
}

interface BrowseResult {
  current: string;
  parent: string | null;
  directories: string[];
}

export function DirectoryPicker({ value, onChange }: DirectoryPickerProps) {
  const [browsing, setBrowsing] = useState(false);
  const [browseData, setBrowseData] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (path?: string) => {
    setLoading(true);
    try {
      const params = path ? `?path=${encodeURIComponent(path)}` : "";
      const res = await fetch(`/api/filesystem/browse${params}`);
      if (res.ok) {
        const data = (await res.json()) as BrowseResult;
        setBrowseData(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (browsing && !browseData) {
      void browse(value || undefined);
    }
  }, [browsing, browseData, browse, value]);

  const handleSelect = (dir: string) => {
    const newPath = `${browseData!.current}/${dir}`;
    onChange(newPath);
    void browse(newPath);
  };

  const handleGoUp = () => {
    if (browseData?.parent) {
      onChange(browseData.parent);
      void browse(browseData.parent);
    }
  };

  const handleConfirm = () => {
    setBrowsing(false);
  };

  if (!browsing) {
    return (
      <div className="flex gap-2">
        <Input
          placeholder="/Users/you/projects/my-app"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setBrowsing(true);
            setBrowseData(null);
          }}
        >
          <Folder className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="border rounded-md p-3 space-y-3">
      <div className="flex items-center gap-2">
        <code className="text-xs text-muted-foreground flex-1 truncate block">
          {browseData?.current ?? "Loading..."}
        </code>
        <Button type="button" variant="ghost" size="icon" onClick={handleGoUp} disabled={!browseData?.parent}>
          <ChevronUp className="w-4 h-4" />
        </Button>
        <Button type="button" size="sm" onClick={handleConfirm}>
          <Check className="w-4 h-4 mr-1" />
          Select
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
      ) : browseData?.directories.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No subdirectories</p>
      ) : (
        <ScrollArea className="h-48">
          <div className="space-y-0.5">
            {browseData?.directories.map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => handleSelect(dir)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent text-left"
              >
                <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="truncate">{dir}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
