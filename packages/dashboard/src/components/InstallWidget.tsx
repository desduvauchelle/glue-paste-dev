import { useState } from "react";
import { X } from "lucide-react";

type Platform = "macos" | "windows" | "ios" | "android" | "unknown";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  return "unknown";
}

function isStandalone(): boolean {
  return (
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

const DISMISS_KEY = "glue-install-widget-dismissed";

const instructions: Record<Exclude<Platform, "unknown">, { browser: string; steps: string[] }> = {
  macos: {
    browser: "Safari",
    steps: [
      "Open this page in Safari",
      "Click the Share button in the toolbar",
      "Select \"Add to Dock\"",
    ],
  },
  windows: {
    browser: "Edge",
    steps: [
      "Open this page in Edge",
      "Click the \u22EF menu (top-right)",
      "Select \"Apps\" \u2192 \"Install this site as an app\"",
    ],
  },
  ios: {
    browser: "Safari",
    steps: [
      "Open this page in Safari",
      "Tap the Share button (bottom bar)",
      "Select \"Add to Home Screen\"",
    ],
  },
  android: {
    browser: "Chrome",
    steps: [
      "Open this page in Chrome",
      "Tap the \u22EE menu (top-right)",
      "Select \"Add to Home screen\"",
    ],
  },
};

export function InstallWidget() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "true"
  );

  if (dismissed || isStandalone()) return null;

  const platform = detectPlatform();
  if (platform === "unknown") return null;

  const info = instructions[platform];

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, "true");
  };

  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40 p-4 relative">
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300"
        aria-label="Dismiss install suggestion"
      >
        <X className="w-4 h-4" />
      </button>
      <p className="text-sm font-medium text-blue-900 dark:text-blue-100 pr-6">
        We highly recommend installing GluePasteDev as an app using {info.browser} for quick access:
      </p>
      <ol className="mt-2 ml-4 list-decimal text-sm text-blue-800 dark:text-blue-200 space-y-0.5">
        {info.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </div>
  );
}
