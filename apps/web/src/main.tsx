import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { Home } from "./components/home/Home";
import { currentProjectId } from "./lib/project";
import "./index.css";

// The editor (and its live collaboration connection) only loads when a project is open: /project/<id> (or legacy /?scene=<id>).
const Editor = lazy(() => import("./App"));
const inEditor = currentProjectId() !== null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {inEditor ? (
      <Suspense fallback={<div className="boot">Opening project…</div>}>
        <Editor />
      </Suspense>
    ) : <Home />}
  </React.StrictMode>,
);
