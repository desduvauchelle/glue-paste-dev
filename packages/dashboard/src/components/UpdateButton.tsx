import { useState, useCallback, useEffect, useRef } from "react";
import { update as updateApi } from "@/lib/api";
import { useWSEvent, useWebSocket } from "@/lib/ws";
import { Button } from "@/components/ui/button";
import { RefreshCw, ArrowDownToLine, Check, AlertCircle, FileText } from "lucide-react";

type State = "idle" | "checking" | "up-to-date" | "update-available" | "updating" | "error";

export function UpdateButton() {
  const [state, setState] = useState<State>("idle");
  const [latestVersion, setLatestVersion] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useWSEvent("update:available", (payload) => {
    const data = payload as { latestVersion: string };
    console.warn("[update] WebSocket: update available, version:", data.latestVersion);
    setLatestVersion(data.latestVersion);
    setState("update-available");
  });

  useWebSocket(useCallback((event) => {
    if (event.type === "ws:reconnected" && state === "updating") {
      console.warn("[update] WebSocket reconnected during update, reloading page");
      window.location.reload();
    }
  }, [state]));

  useEffect(() => {
    if (state === "updating") {
      updateTimeoutRef.current = setTimeout(() => {
        setErrorMsg("Update timed out — daemon did not restart. Check update logs.");
        setState("error");
      }, 90_000);
    } else {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
    }
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
    };
  }, [state]);

  const fetchLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await updateApi.logs();
      setLogLines(res.lines);
    } catch {
      setLogLines(["Failed to fetch update logs"]);
    }
    setLogsLoading(false);
  };

  const handleViewLogs = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showLogs) {
      setShowLogs(false);
      return;
    }
    await fetchLogs();
    setShowLogs(true);
  };

  const handleCheck = async () => {
    if (state === "checking" || state === "updating") return;
    if (state === "update-available" || state === "error") {
      console.warn("[update] applying update...");
      setState("updating");
      setShowLogs(false);
      try {
        await updateApi.apply();
        console.warn("[update] apply request sent, waiting for restart...");
      } catch (err) {
        let msg: string;
        if (err instanceof TypeError && err.message === "Failed to fetch") {
          msg = "Cannot reach server";
        } else if (err instanceof Error) {
          msg = err.message;
        } else {
          msg = "Update failed";
        }
        console.error("[update] apply FAILED:", msg);
        setErrorMsg(msg);
        setState("error");
      }
      return;
    }
    console.warn("[update] checking for updates...");
    setState("checking");
    try {
      const res = await updateApi.check();
      console.warn("[update] check result:", JSON.stringify(res));
      if (res.available) {
        setLatestVersion(res.latestVersion);
        setState("update-available");
      } else {
        setState("up-to-date");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch (err) {
      let msg: string;
      if (err instanceof TypeError && err.message === "Failed to fetch") {
        msg = "Cannot reach server";
      } else if (err instanceof Error) {
        msg = err.message;
      } else {
        msg = "Check failed";
      }
      console.error("[update] check FAILED:", msg);
      setErrorMsg(msg);
      setState("error");
    }
  };

  const logsPanel = showLogs && (
    <div className="absolute top-full right-0 mt-1 w-[500px] max-h-[300px] overflow-auto bg-popover text-popover-foreground border border-border rounded-lg shadow-lg z-50 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium">Update Logs</span>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); setShowLogs(false); }}
        >
          Close
        </button>
      </div>
      {logsLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : logLines.length === 0 ? (
        <p className="text-xs text-muted-foreground">No update log entries found</p>
      ) : (
        <pre className="text-[10px] leading-relaxed font-mono whitespace-pre-wrap break-all text-muted-foreground">
          {logLines.join("\n")}
        </pre>
      )}
    </div>
  );

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

  if (state === "error") {
    return (
      <div className="relative">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCheck}
            className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 text-xs gap-1.5 h-8 px-2"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="max-w-[200px] truncate">{errorMsg || "Update failed"}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleViewLogs}
            title="View update logs"
            className="text-muted-foreground hover:text-foreground h-8 w-8"
          >
            <FileText className="w-3.5 h-3.5" />
          </Button>
        </div>
        {logsPanel}
      </div>
    );
  }

  // updating
  return (
    <Button variant="ghost" size="icon" disabled className="text-amber-500">
      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
    </Button>
  );
}
