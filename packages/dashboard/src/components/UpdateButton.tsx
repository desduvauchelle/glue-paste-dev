import { useState, useCallback } from "react";
import { update as updateApi } from "@/lib/api";
import { useWSEvent, useWebSocket } from "@/lib/ws";
import { Button } from "@/components/ui/button";
import { RefreshCw, ArrowDownToLine, Check } from "lucide-react";

type State = "idle" | "checking" | "up-to-date" | "update-available" | "updating";

export function UpdateButton() {
  const [state, setState] = useState<State>("idle");
  const [latestVersion, setLatestVersion] = useState("");

  useWSEvent("update:available", (payload) => {
    const data = payload as { latestVersion: string };
    setLatestVersion(data.latestVersion);
    setState("update-available");
  });

  useWebSocket(useCallback((event) => {
    if (event.type === "ws:reconnected" && state === "updating") {
      window.location.reload();
    }
  }, [state]));

  const handleCheck = async () => {
    if (state === "checking" || state === "updating") return;
    if (state === "update-available") {
      setState("updating");
      try {
        await updateApi.apply();
      } catch {
        setState("update-available");
      }
      return;
    }
    setState("checking");
    try {
      const res = await updateApi.check();
      if (res.available) {
        setLatestVersion(res.latestVersion);
        setState("update-available");
      } else {
        setState("up-to-date");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch {
      setState("idle");
    }
  };

  if (state === "idle") {
    return (
      <div className="relative group">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCheck}
          className="text-muted-foreground/50 hover:text-muted-foreground"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-popover text-popover-foreground border border-border rounded shadow-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">
          Check for updates
        </div>
      </div>
    );
  }

  if (state === "checking") {
    return (
      <Button variant="ghost" size="icon" disabled className="text-muted-foreground/50">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
      </Button>
    );
  }

  if (state === "up-to-date") {
    return (
      <Button variant="ghost" size="icon" disabled className="text-green-500">
        <Check className="w-3.5 h-3.5" />
      </Button>
    );
  }

  if (state === "update-available") {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCheck}
        title={`Update to v${latestVersion}`}
        className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950 text-xs gap-1.5 h-8 px-2"
      >
        <ArrowDownToLine className="w-3.5 h-3.5" />
        v{latestVersion}
      </Button>
    );
  }

  // updating
  return (
    <Button variant="ghost" size="icon" disabled className="text-amber-500">
      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
    </Button>
  );
}
