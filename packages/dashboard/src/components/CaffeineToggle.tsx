import { useState, useEffect, useCallback } from "react";
import { caffeinate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Coffee } from "lucide-react";

export function CaffeineToggle() {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(() => {
    caffeinate.status().then((s) => setActive(s.active)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const toggle = async () => {
    setLoading(true);
    try {
      if (active) {
        const res = await caffeinate.stop();
        setActive(res.active);
      } else {
        const res = await caffeinate.start();
        setActive(res.active);
      }
    } catch {
      fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => void toggle()}
      disabled={loading}
      title={active ? "Caffeinate: ON (click to stop)" : "Caffeinate: OFF (click to start)"}
    >
      <Coffee
        className={`w-4 h-4 transition-colors ${
          active ? "text-green-500" : "text-zinc-400 opacity-50"
        }`}
      />
    </Button>
  );
}
