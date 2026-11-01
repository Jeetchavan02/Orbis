import React, { lazy, Suspense, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { Home } from "./components/home/Home";
import { AuthScreen, type AuthMode } from "./components/auth/AuthScreen";
import { currentProjectId } from "./lib/project";
import { applyIdentity, fetchMe, type Me } from "./lib/auth";
import { OrbisMark } from "./components/brand/Logo";
import "./index.css";

function BootScreen({ label }: { label: string }) {
  return <div className="boot"><span className="boot-mark"><OrbisMark size={44} /></span><span>{label}</span></div>;
}

// The editor (and its live collaboration connection) only loads when a project is open: /project/<id> (or legacy /?scene=<id>).
const Editor = lazy(() => import("./App"));

const AUTH_ROUTES: Record<string, AuthMode> = { "/login": "login", "/signup": "signup", "/forgot-password": "forgot", "/reset-password": "reset" };

/** Shared project links work for guests; signed-in users join under their account name. */
function EditorRoute() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void fetchMe().then((user) => {
      if (user) applyIdentity(user);
      setReady(true);
    });
  }, []);
  if (!ready) return <BootScreen label="Opening project…" />;
  return (
    <Suspense fallback={<BootScreen label="Opening project…" />}>
      <Editor />
    </Suspense>
  );
}

/** The dashboard needs an account (projects belong to someone); send guests to log in and come back. */
function DashboardRoute() {
  const [user, setUser] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    void fetchMe().then((me) => {
      if (!me) {
        location.replace("/login" + (location.pathname !== "/" || location.search ? "?next=" + encodeURIComponent(location.pathname + location.search) : ""));
        return;
      }
      applyIdentity(me);
      setUser(me);
    });
  }, []);
  if (!user) return <BootScreen label="Loading your projects…" />;
  return <Home user={user} />;
}

function Router() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  if (currentProjectId() !== null) return <EditorRoute />;
  const mode = AUTH_ROUTES[path];
  if (mode) return <AuthScreen mode={mode} />;
  return <DashboardRoute />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>,
);
