import { Route, Switch } from "wouter";
import { Home } from "./pages/Home";
import { BoardView } from "./pages/BoardView";
import { GlobalSettings } from "./pages/GlobalSettings";
import { ToastContainer } from "./components/ui/toast";
import { UpdateBanner } from "./components/UpdateBanner";
import { useNotificationPermission, useNotificationListener } from "./lib/notifications";

function NotificationSetup() {
  useNotificationPermission();
  useNotificationListener();
  return null;
}

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <NotificationSetup />
      <UpdateBanner />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/settings" component={GlobalSettings} />
        <Route path="/boards/:boardId" component={BoardView} />
      </Switch>
      <ToastContainer />
    </div>
  );
}
