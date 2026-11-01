import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Bell, ChevronRight, PanelLeft, Box, Boxes, Copy, FolderOpen, Grid2X2, Home as HomeIcon, LayoutGrid, Loader2, MoreVertical, Pencil, Plus,
  Search, Settings, ShieldCheck, Sparkles, Trash2, Upload, Users, X, Zap,
} from "lucide-react";
import { catalog, GROUPS, type GroupId } from "../../data/catalog";
import { useThumbnail } from "../../lib/thumbnails";
import { loadProfile, saveDefaultProfile } from "../../lib/collab";
import { UploadPlan } from "./UploadPlan";
import { BlankRoomArt, HeroArt, ROOM_ART } from "./Illustrations";

type Project = { id: string; name: string; roomType: string; objects: number; floors: number; updatedAt: string; thumbnail: string | null };
type View = "upload" | "home" | "projects" | "templates" | "library" | "team" | "settings";
type Draft = { name: string; roomType: string; template: string | null; width: number; depth: number };

const TEMPLATES: { id: keyof typeof ROOM_ART; label: string; name: string; roomType: string }[] = [
  { id: "bedroom", label: "Bedroom", name: "My Bedroom", roomType: "bedroom" },
  { id: "living", label: "Living Room", name: "Living Room", roomType: "living" },
  { id: "dining", label: "Dining Room", name: "Dining Room", roomType: "dining" },
  { id: "kitchen", label: "Kitchen", name: "Kitchen", roomType: "kitchen" },
  { id: "office", label: "Home Office", name: "Home Office", roomType: "office" },
];
const ROOM_LABELS: Record<string, string> = { bedroom: "Bedroom", living: "Living Room", dining: "Dining Room", kitchen: "Kitchen", office: "Home Office", apartment: "Apartment", bathroom: "Bathroom", kids: "Kids' Room", study: "Study" };
const SIZES: [number, number][] = [[10, 10], [12, 14], [8, 12]];

const openProject = (id: string) => location.assign(`/?scene=${encodeURIComponent(id)}`);

function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Edited just now";
  if (minutes < 60) return `Edited ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Edited ${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Edited yesterday" : `Edited ${days} days ago`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? `Request failed (${response.status})`);
  return payload as T;
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

const BADGE_COLORS = ["#b9a4f5", "#f2a7a0", "#9cc7ef", "#a6dcc0", "#f3cf8a"];
function badgeColor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BADGE_COLORS[hash % BADGE_COLORS.length];
}

function ProjectThumb({ project }: { project: Project }) {
  const Art = ROOM_ART[project.roomType as keyof typeof ROOM_ART] ?? ROOM_ART.bedroom;
  return <div className="project-thumb">{project.thumbnail ? <img src={project.thumbnail} alt="" /> : <Art />}</div>;
}

function ProjectCard({ project, onChanged, wide }: { project: Project; onChanged: () => void; wide?: boolean }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);
  const act = async (fn: () => Promise<unknown>) => {
    setMenu(false);
    try {
      await fn();
      onChanged();
    } catch (error) {
      alert((error as Error).message);
    }
  };
  return (
    <div className={"project-card" + (wide ? " project-card--wide" : "")} ref={ref}>
      <button type="button" className="project-open" onClick={() => openProject(project.id)} aria-label={`Open ${project.name}`}>
        <ProjectThumb project={project} />
      </button>
      <div className="project-meta">
        {renaming ? (
          <form onSubmit={(event) => { event.preventDefault(); setRenaming(false); void act(() => api(`/api/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ name }) })); }}>
            <input className="rename-input" value={name} autoFocus onChange={(event) => setName(event.target.value)} onBlur={() => setRenaming(false)} aria-label="Project name" />
          </form>
        ) : (
          <button type="button" className="project-name" onClick={() => openProject(project.id)}>{project.name}</button>
        )}
        <span>{ROOM_LABELS[project.roomType] ?? "Room"} · {ago(project.updatedAt)}</span>
      </div>
      <button type="button" className="kebab" aria-label="Project actions" aria-haspopup="menu" onClick={() => setMenu(!menu)}><MoreVertical size={16} /></button>
      {menu ? (
        <div className="home-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => openProject(project.id)}><FolderOpen size={14} /> Open</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(false); setRenaming(true); }}><Pencil size={14} /> Rename</button>
          <button type="button" role="menuitem" onClick={() => void act(() => api(`/api/projects/${project.id}/duplicate`, { method: "POST" }))}><Copy size={14} /> Duplicate</button>
          <button type="button" role="menuitem" className="danger" onClick={() => confirm(`Delete “${project.name}”? This cannot be undone.`) && void act(() => api(`/api/projects/${project.id}`, { method: "DELETE" }))}><Trash2 size={14} /> Delete</button>
        </div>
      ) : null}
    </div>
  );
}

function LibraryThumb({ id }: { id: string }) {
  const entry = catalog.find((item) => item.id === id)!;
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const url = useThumbnail(entry, element);
  return <div ref={setElement} className="lib-thumb">{url ? <img src={url} alt="" /> : null}</div>;
}

function NewProjectDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [value, setValue] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/api/projects", { method: "POST", body: JSON.stringify(value) });
      openProject(id);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal new-project">
        <header className="share-head"><h2 id="new-project-title">New project</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={16} /></button></header>
        <label className="form-row"><span>Project name</span><input value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} autoFocus /></label>
        <label className="form-row"><span>Room type</span>
          <select value={value.roomType} onChange={(event) => setValue({ ...value, roomType: event.target.value })}>
            {Object.entries(ROOM_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <div className="form-row"><span>Start from</span>
          <div className="start-grid">
            <button type="button" className={"start-option" + (value.template === null ? " active" : "")} onClick={() => setValue({ ...value, template: null })}><BlankRoomArt /><strong>Blank room</strong></button>
            {TEMPLATES.map((template) => {
              const Art = ROOM_ART[template.id];
              return <button key={template.id} type="button" className={"start-option" + (value.template === template.id ? " active" : "")} onClick={() => setValue({ ...value, template: template.id, roomType: template.roomType })}><Art /><strong>{template.label}</strong></button>;
            })}
            <button type="button" className={"start-option" + (value.template === "apartment" ? " active" : "")} onClick={() => setValue({ ...value, template: "apartment", roomType: "apartment" })}><ROOM_ART.living /><strong>3-floor apartment</strong></button>
          </div>
        </div>
        {value.template === null ? (
          <div className="form-row form-row--inline">
            <label><span>Width (m)</span><input type="number" min={2} max={30} step={0.5} value={value.width} onChange={(event) => setValue({ ...value, width: Number(event.target.value) })} /></label>
            <label><span>Depth (m)</span><input type="number" min={2} max={30} step={0.5} value={value.depth} onChange={(event) => setValue({ ...value, depth: Number(event.target.value) })} /></label>
          </div>
        ) : null}
        {error ? <p className="issue-inline issue-inline--error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" disabled={busy || !value.name.trim()} onClick={() => void create()}>{busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Create project</button>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: Box, title: "3D Design", text: "Build & customize rooms" },
  { icon: ShieldCheck, title: "Spatial Intelligence", text: "Validate, optimize & fix layouts" },
  { icon: Users, title: "Real-time Collaboration", text: "Design together, anywhere" },
  { icon: Sparkles, title: "Smart Layouts", text: "Get intelligent suggestions" },
];

export function Home() {
  const [view, setView] = useState<View>("home");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [bell, setBell] = useState(false);
  const [libraryGroup, setLibraryGroup] = useState<GroupId | "all">("all");
  const [profile, setProfile] = useState(loadProfile);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("rb.sidebar") === "1"; } catch { return false; } });
  const toggleCollapsed = () => setCollapsed((value) => { try { localStorage.setItem("rb.sidebar", value ? "0" : "1"); } catch { /* ignore */ } return !value; });
  const load = () => api<{ projects: Project[] }>("/api/projects").then((data) => setProjects(data.projects)).catch((failure) => setError((failure as Error).message));
  useEffect(() => void load(), []);

  const needle = query.trim().toLowerCase();
  const results = useMemo(() => needle ? {
    projects: (projects ?? []).filter((project) => project.name.toLowerCase().includes(needle)).slice(0, 5),
    templates: TEMPLATES.filter((template) => template.label.toLowerCase().includes(needle)),
    objects: catalog.filter((entry) => entry.name.toLowerCase().includes(needle)),
  } : null, [needle, projects]);

  const [opening, setOpening] = useState<string | null>(null);
  const createFrom = async (body: Draft) => {
    if (opening) return;
    setOpening(body.template ?? "blank");
    try {
      const { id } = await api<{ id: string }>("/api/projects", { method: "POST", body: JSON.stringify(body) });
      openProject(id);
    } catch (failure) {
      setOpening(null);
      alert((failure as Error).message);
    }
  };
  const startTemplate = (template: (typeof TEMPLATES)[number]) => void createFrom({ name: template.name, roomType: template.roomType, template: template.id, width: 4.5, depth: 4 });
  const startBlank = (width = 5, depth = 4) => setDraft({ name: "New room", roomType: "bedroom", template: null, width, depth });
  const firstName = profile.name.split(/\s+/)[0];

  const nav: { id: View; label: string; icon: typeof HomeIcon }[] = [
    { id: "home", label: "Home", icon: HomeIcon }, { id: "projects", label: "All projects", icon: FolderOpen },
  ];
  const explore: { id: View; label: string; icon: typeof HomeIcon }[] = [
    { id: "templates", label: "Templates", icon: LayoutGrid }, { id: "library", label: "Library", icon: Boxes }, { id: "team", label: "Collaborate", icon: Users },
  ];

  const templateRow = (
    <div className="template-row">
      {TEMPLATES.map((template) => {
        const Art = ROOM_ART[template.id];
        return (
          <button key={template.id} type="button" className="template-card" disabled={opening !== null} onClick={() => startTemplate(template)} title={`Open a new ${template.label.toLowerCase()} project`}>
            <div className="template-art"><Art />{opening === template.id ? <span className="template-busy"><Loader2 size={20} className="spin" /></span> : null}</div>
            <strong>{template.label}</strong>
          </button>
        );
      })}
    </div>
  );

  if (view === "upload") return <UploadPlan onBack={() => setView("home")} />;

  return (
    <div className="home">
      <aside className={"home-sidebar" + (collapsed ? " home-sidebar--collapsed" : "")}>
        <div className="hs-head">
          <span className="brand-cube"><Box size={18} /></span>
          <strong className="hs-title">Reality Builder</strong>
          <button type="button" className="hs-toggle" onClick={toggleCollapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}><PanelLeft size={18} /></button>
        </div>
        <nav className="hs-group">
          {nav.map((item) => <button key={item.id} type="button" className={view === item.id ? "active" : ""} onClick={() => setView(item.id)} title={item.label}><item.icon size={18} /><span>{item.label}</span></button>)}
          <button type="button" onClick={() => startBlank()} title="New project"><Plus size={18} /><span>New project</span></button>
          <button type="button" onClick={() => setView("upload")} title="Upload a floor plan"><Upload size={18} /><span>Upload a plan</span></button>
        </nav>
        <div className="hs-group">
          <span className="hs-label">Projects</span>
          {(projects ?? []).slice(0, 5).map((project) => (
            <button key={project.id} type="button" className="hs-project" onClick={() => openProject(project.id)} title={project.name}>
              <span className="hs-badge" style={{ background: badgeColor(project.id) }}>{initials(project.name)[0]}</span><span>{project.name}</span><ChevronRight size={15} className="hs-chev" />
            </button>
          ))}
          {projects && projects.length > 5 ? <button type="button" className="hs-more" onClick={() => setView("projects")}><span>See all {projects.length}</span></button> : null}
          {projects && !projects.length ? <p className="hs-empty">No projects yet</p> : null}
        </div>
        <div className="hs-group">
          <span className="hs-label">Explore</span>
          {explore.map((item) => <button key={item.id} type="button" className={view === item.id ? "active" : ""} onClick={() => setView(item.id)} title={item.label}><item.icon size={18} /><span>{item.label}</span></button>)}
        </div>
        <div className="hs-foot">
          <div className="hs-plan">
            <span className="avatar" style={{ background: profile.color }}>{initials(profile.name)}</span>
            <span className="hs-plan-text"><small>Local workspace</small><strong>{profile.name}</strong></span>
            <button type="button" className="icon-button" onClick={() => setView("settings")} title="Settings" aria-label="Settings"><Settings size={17} /></button>
          </div>
        </div>
      </aside>

      <main className="home-main">
        <header className="home-top">
          <div className="home-search">
            <Search size={17} />
            <input placeholder="Search projects, templates, or objects…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search" />
            {results ? (
              <div className="search-results">
                {results.projects.map((project) => <button key={project.id} type="button" onClick={() => openProject(project.id)}><FolderOpen size={14} /> {project.name}<small>Project</small></button>)}
                {results.templates.map((template) => <button key={template.id} type="button" onClick={() => { setQuery(""); startTemplate(template); }}><LayoutGrid size={14} /> {template.label}<small>Template</small></button>)}
                {results.objects.length ? <button type="button" onClick={() => { setView("library"); }}><Boxes size={14} /> {results.objects.length} library objects match<small>Library</small></button> : null}
                {!results.projects.length && !results.templates.length && !results.objects.length ? <p className="field-note pad">No matches.</p> : null}
              </div>
            ) : null}
          </div>
          <div className="home-top-actions">
            <div className="menu">
              <button type="button" className="icon-button" aria-label="Notifications" onClick={() => setBell(!bell)}><Bell size={19} />{(projects?.length ?? 0) > 0 ? <span className="dot" /> : null}</button>
              {bell ? (
                <div className="home-menu home-menu--right" role="menu">
                  {(projects ?? []).slice(0, 4).map((project) => <button key={project.id} type="button" onClick={() => openProject(project.id)}><FolderOpen size={14} /> {project.name} · {ago(project.updatedAt).toLowerCase()}</button>)}
                  {!projects?.length ? <p className="field-note pad">No activity yet.</p> : null}
                </div>
              ) : null}
            </div>
            <button type="button" className="avatar avatar--lg" style={{ background: profile.color }} onClick={() => setView("settings")} aria-label="Profile settings">{initials(profile.name)}</button>
          </div>
        </header>

        {view === "home" ? (
          <div className="home-content">
            <section className="hero">
              <div className="hero-copy">
                <h1>Welcome back, {firstName}</h1>
                <p>Design, plan and collaborate on beautiful interior spaces in 3D.</p>
                <div className="hero-actions">
                  <button type="button" className="primary-button primary-button--lg" onClick={() => startBlank()}><Plus size={18} /> New Project</button>
                  <button type="button" className="ghost-button ghost-button--lg" onClick={() => setView("templates")}><Grid2X2 size={18} /> Browse Templates</button>
                  <button type="button" className="ghost-button ghost-button--lg" onClick={() => setView("upload")}><Upload size={18} /> Upload a plan</button>
                </div>
              </div>
              <HeroArt />
            </section>
            <section className="features">
              {FEATURES.map((feature) => <div key={feature.title} className="feature"><span className="feature-icon"><feature.icon size={20} /></span><span><strong>{feature.title}</strong><small>{feature.text}</small></span></div>)}
            </section>
            <section className="start-section">
              <div className="start-main">
                <div className="section-head"><h2>Start a new project</h2><button type="button" className="link-button" onClick={() => setView("templates")}>View all templates <ArrowRight size={16} /></button></div>
                {templateRow}
              </div>
              <aside className="quick-start">
                <h3><Zap size={16} /> Quick start</h3>
                <p>Set up a room in seconds.</p>
                <div className="quick-art"><BlankRoomArt /></div>
                <button type="button" className="outline-button" onClick={() => startBlank()}><Plus size={16} /> Create blank room</button>
                <span className="quick-label">Common sizes</span>
                <div className="size-chips">{SIZES.map(([w, d]) => <button key={`${w}x${d}`} type="button" onClick={() => startBlank(w, d)}>{w} × {d} m</button>)}</div>
              </aside>
            </section>
            <section>
              <div className="section-head"><h2>Recent Projects</h2><button type="button" className="link-button" onClick={() => setView("projects")}>View all projects <ArrowRight size={16} /></button></div>
              {error ? <p className="issue-inline issue-inline--error">Could not load projects: {error}</p> : null}
              {!projects ? <p className="field-note"><Loader2 size={13} className="spin" /> Loading projects…</p> : projects.length === 0 ? (
                <div className="empty-projects"><BlankRoomArt /><span>No projects yet — pick a template or create a blank room to get started.</span></div>
              ) : <div className="recent-row">{projects.slice(0, 3).map((project) => <ProjectCard key={project.id} project={project} onChanged={() => void load()} wide />)}</div>}
            </section>
          </div>
        ) : null}

        {view === "projects" ? (
          <div className="home-content">
            <div className="section-head"><h2>All projects</h2><button type="button" className="primary-button" onClick={() => startBlank()}><Plus size={16} /> New Project</button></div>
            {!projects ? <p className="field-note"><Loader2 size={13} className="spin" /> Loading…</p> : <div className="projects-grid">{projects.map((project) => <ProjectCard key={project.id} project={project} onChanged={() => void load()} />)}</div>}
          </div>
        ) : null}

        {view === "templates" ? (
          <div className="home-content">
            <div className="section-head"><h2>Templates</h2></div>
            <p className="field-note">Every template is a fully editable scene that passes the spatial checks.</p>
            {templateRow}
            <div className="section-head"><h2>More starting points</h2></div>
            <div className="template-row">
              <button type="button" className="template-card" disabled={opening !== null} onClick={() => void createFrom({ name: "My Apartment", roomType: "apartment", template: "apartment", width: 7, depth: 5.6 })}><div className="template-art"><ROOM_ART.living />{opening === "apartment" ? <span className="template-busy"><Loader2 size={20} className="spin" /></span> : null}</div><strong>3-floor apartment</strong></button>
              <button type="button" className="template-card" onClick={() => startBlank()}><div className="template-art"><BlankRoomArt /></div><strong>Blank room</strong></button>
            </div>
          </div>
        ) : null}

        {view === "library" ? (
          <div className="home-content">
            <div className="section-head"><h2>Library · {catalog.length} objects</h2></div>
            <div className="lib-groups lib-groups--home">
              <button type="button" className={libraryGroup === "all" ? "active" : ""} onClick={() => setLibraryGroup("all")}>All</button>
              {(Object.keys(GROUPS) as GroupId[]).map((group) => <button key={group} type="button" className={libraryGroup === group ? "active" : ""} onClick={() => setLibraryGroup(group)}>{GROUPS[group].label}</button>)}
            </div>
            <div className="home-library-grid">
              {catalog.filter((entry) => (libraryGroup === "all" || entry.group === libraryGroup) && (!needle || entry.name.toLowerCase().includes(needle))).slice(0, 120).map((entry) => (
                <div key={entry.id} className="lib-card lib-card--static"><LibraryThumb id={entry.id} /><span className="lib-name">{entry.name}</span><span className="lib-dims">{entry.dimensions.width} × {entry.dimensions.depth} m</span></div>
              ))}
            </div>
            <p className="field-note">Open a project to drag these into a room.</p>
          </div>
        ) : null}

        {view === "team" ? (
          <div className="home-content narrow">
            <div className="section-head"><h2>Team</h2></div>
            <div className="info-card">
              <Users size={22} />
              <div>
                <strong>Collaborate live</strong>
                <p>Open any project and click <b>Share</b>. Everyone with the link edits the same scene with live cursors; conflicting edits are detected, never silently overwritten.</p>
                <p className="field-note">Same Wi-Fi: run <code>npm run dev:share</code>. Anywhere: run a Cloudflare tunnel to <code>localhost:5173</code>.</p>
              </div>
            </div>
          </div>
        ) : null}

        {view === "settings" ? (
          <div className="home-content narrow">
            <div className="section-head"><h2>Settings</h2></div>
            <div className="info-card info-card--form">
              <label className="form-row"><span>Display name (shown to collaborators)</span><input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
              <div className="form-row"><span>Colour</span><div className="share-colors">{["#6a3de8", "#d9603b", "#3b82d9", "#2f9e6e", "#c2417a", "#c79a1e"].map((swatch) => <button key={swatch} type="button" aria-label={swatch} className={"share-color" + (profile.color === swatch ? " share-color--active" : "")} style={{ background: swatch }} onClick={() => setProfile({ ...profile, color: swatch })} />)}</div></div>
              <div className="modal-actions"><button type="button" className="primary-button" disabled={!profile.name.trim()} onClick={() => { saveDefaultProfile(profile.name.trim(), profile.color); setView("home"); }}>Save</button></div>
            </div>
          </div>
        ) : null}
      </main>
      {draft ? <NewProjectDialog draft={draft} onClose={() => setDraft(null)} /> : null}
    </div>
  );
}
