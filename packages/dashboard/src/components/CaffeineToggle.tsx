import { useState, useEffect, useCallback } from "react";
import { caffeinate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Coffee } from "lucide-react";

export function CaffeineToggle() {
  const [active, setActive] = useState(false);
  const [activeBoards, setActiveBoards] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(() => {
    caffeinate.status().then((s) => {
      setActive(s.active);
      setActiveBoards(s.activeBoards ?? []);
    }).catch(() => {});
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
        if (!res.active) setActiveBoards([]);
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

  const tooltipText = active && activeBoards.length > 0
    ? `Keeping awake: ${activeBoards.map((b) => b.name).join(", ")}`
    : active
    ? "Caffeinate: ON (click to stop)"
    : "Caffeinate: OFF (click to start)";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void toggle()}
          disabled={loading}
        >
          <Coffee
            className={`w-4 h-4 transition-colors ${
              active ? "text-green-500" : "text-zinc-400 opacity-50"
            }`}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
