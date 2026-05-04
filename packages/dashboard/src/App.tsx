import { Route, Switch } from "wouter";
import { Home } from "./pages/Home";
import { BoardView } from "./pages/BoardView";
import { GlobalSettings } from "./pages/GlobalSettings";
import { ToastContainer } from "./components/ui/toast";
import { useNotificationPermission, useNotificationListener } from "./lib/notifications";
import { SwirlGradient } from "./components/ui/swirling-gradient";

function NotificationSetup() {
  useNotificationPermission();
  useNotificationListener();
  return null;
}

export function App() {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <SwirlGradient className="fixed inset-0 w-full h-full -z-10 opacity-30" />
      <NotificationSetup />
<Switch>
        <Route path="/" component={Home} />
        <Route path="/settings" component={GlobalSettings} />
        <Route path="/boards/:boardId" component={BoardView} />
      </Switch>
      <ToastContainer />
    </div>
  );
}
