import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { Home } from "./components/home/Home";
import "./index.css";

// The editor (and its live collaboration connection) only loads when a project is open: /?scene=<id>.
const Editor = lazy(() => import("./App"));
const inEditor = new URLSearchParams(location.search).has("scene");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {inEditor ? (
      <Suspense fallback={<div className="boot">Opening project…</div>}>
        <Editor />
      </Suspense>
    ) : <Home />}
  </React.StrictMode>,
);
