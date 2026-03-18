import { useState, useEffect } from "react";
import { update as updateApi } from "@/lib/api";
import { useWSEvent } from "@/lib/ws";
import { useWebSocket } from "@/lib/ws";
import { Button } from "@/components/ui/button";

export function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("");
  const [latestVersion, setLatestVersion] = useState("");
  const [updating, setUpdating] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Check on mount
  useEffect(() => {
    updateApi.check().then((res) => {
      if (res.available) {
        setAvailable(true);
        setCurrentVersion(res.currentVersion);
        setLatestVersion(res.latestVersion);
      }
    }).catch(() => {});
  }, []);

  // Listen for WS push
  useWSEvent("update:available", (payload) => {
    const data = payload as { currentVersion: string; latestVersion: string };
    setAvailable(true);
    setCurrentVersion(data.currentVersion);
    setLatestVersion(data.latestVersion);
    setDismissed(false);
  });

  // After update applied, reload when WS reconnects
  useWebSocket((event) => {
    if (event.type === "ws:reconnected" && updating) {
      window.location.reload();
    }
  });

  if (!available || dismissed) return null;

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      await updateApi.apply();
      // Server will restart — ws:reconnected handler will reload the page
    } catch {
      setUpdating(false);
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 bg-primary px-4 py-2 text-primary-foreground text-sm">
      <span>
        Update available: v{currentVersion} → v{latestVersion}
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={handleUpdate}
        disabled={updating}
      >
        {updating ? "Updating..." : "Update now"}
      </Button>
      {!updating && (
        <button
          onClick={() => setDismissed(true)}
          className="ml-1 opacity-70 hover:opacity-100"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}
