import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Check, CircleAlert, Eye, EyeOff, Loader2, MailCheck, ShieldCheck, Sparkles, Users } from "lucide-react";
import { OrbisMark } from "../brand/Logo";
import { applyIdentity, AuthError, authFetch, nextPath, passwordStrength, type AuthConfig, type Me } from "../../lib/auth";

export type AuthMode = "login" | "signup" | "forgot" | "reset";

const PATHS: Record<AuthMode, string> = { login: "/login", signup: "/signup", forgot: "/forgot-password", reset: "/reset-password" };

function go(mode: AuthMode) {
  const next = new URLSearchParams(location.search).get("next");
  history.pushState(null, "", PATHS[mode] + (next ? "?next=" + encodeURIComponent(next) : ""));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function finish(user: Me) {
  applyIdentity(user);
  location.assign(nextPath());
}

function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className={"auth-field" + (error ? " auth-field--error" : "")}>
      <span className="auth-label">{label}</span>
      {children}
      {error ? <span className="auth-error-text" role="alert"><CircleAlert size={13} /> {error}</span> : hint ?? null}
    </label>
  );
}

function PasswordInput({ value, onChange, autoComplete, placeholder, invalid }: { value: string; onChange: (value: string) => void; autoComplete: string; placeholder?: string; invalid?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="auth-input auth-input--password">
      <input type={shown ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} placeholder={placeholder} aria-invalid={invalid || undefined} required />
      <button type="button" className="auth-eye" onClick={() => setShown(!shown)} aria-label={shown ? "Hide password" : "Show password"} title={shown ? "Hide password" : "Show password"}>
        {shown ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  );
}

function Strength({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  if (!password) return <span className="auth-hint">At least 8 characters. Longer is stronger.</span>;
  return (
    <span className="auth-strength" aria-live="polite">
      <span className="auth-strength-bars">{[1, 2, 3, 4].map((step) => <span key={step} className={step <= score ? "on s" + score : ""} />)}</span>
      <span className={"auth-strength-label s" + score}>{label}</span>
    </span>
  );
}

/** Google Identity Services button, only when the server has a GOOGLE_CLIENT_ID. */
function GoogleButton({ clientId, onError }: { clientId: string; onError: (message: string) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    type Gsi = { accounts: { id: { initialize: (options: object) => void; renderButton: (element: HTMLElement, options: object) => void } } };
    const render = () => {
      const google = (window as unknown as { google?: Gsi }).google;
      if (!google || !holder.current) return;
      google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }: { credential: string }) => {
          try {
            finish((await authFetch<{ user: Me }>("google", { credential })).user);
          } catch (error) {
            onError((error as Error).message);
          }
        },
      });
      google.accounts.id.renderButton(holder.current, { theme: "outline", size: "large", width: 360, text: "continue_with", shape: "pill" });
    };
    if ((window as unknown as { google?: unknown }).google) return render();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = render;
    script.onerror = () => onError("Couldn't load Google sign-in. Use email instead.");
    document.head.appendChild(script);
  }, [clientId, onError]);
  return <div className="auth-google" ref={holder} />;
}

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const token = new URLSearchParams(location.search).get("token") ?? "";

  useEffect(() => {
    // Already signed in: skip straight to where they were going.
    if (mode === "login" || mode === "signup") void authFetch<{ user: Me | null }>("me").then((data) => { if (data.user) location.replace(nextPath()); }, () => undefined);
  }, [mode]);
  useEffect(() => {
    void authFetch<AuthConfig>("config").then(setConfig, () => setConfig({ google: null, resetLinksVisible: false }));
  }, []);
  useEffect(() => {
    setError(null);
    setFieldErrors({});
    setDone(false);
    setResetUrl(null);
    document.title = { login: "Log in", signup: "Create account", forgot: "Reset password", reset: "Choose a new password" }[mode] + " · Orbis";
  }, [mode]);

  const validate = () => {
    const errors: Record<string, string> = {};
    if (mode === "signup" && !name.trim()) errors.name = "Enter your name.";
    if (mode !== "reset" && !/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = "Enter a valid email address.";
    if (mode === "login" && !password) errors.password = "Enter your password.";
    if ((mode === "signup" || mode === "reset") && password.length < 8) errors.password = "Use at least 8 characters.";
    if ((mode === "signup" || mode === "reset") && confirm !== password) errors.confirm = "Passwords don't match.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      if (mode === "login") finish((await authFetch<{ user: Me }>("login", { email, password, remember })).user);
      else if (mode === "signup") finish((await authFetch<{ user: Me }>("signup", { name, email, password })).user);
      else if (mode === "reset") {
        const { user } = await authFetch<{ user: Me }>("reset", { token, password });
        setDone(true);
        window.setTimeout(() => finish(user), 900);
      } else {
        const result = await authFetch<{ ok: boolean; resetUrl?: string }>("forgot", { email });
        setResetUrl(result.resetUrl ?? null);
        setDone(true);
        setBusy(false);
      }
    } catch (failure) {
      const authError = failure as AuthError;
      if (authError.field) setFieldErrors({ [authError.field]: authError.message });
      else setError(authError.message);
      setBusy(false);
    }
  };

  const titles: Record<AuthMode, [string, string]> = {
    login: ["Welcome back", "Log in to continue designing with your team."],
    signup: ["Create your account", "Design rooms in 3D and invite anyone with a link."],
    forgot: ["Forgot your password?", "Enter your email and we'll send you a reset link."],
    reset: ["Choose a new password", "You'll be signed in right after."],
  };

  return (
    <div className="auth">
      <section className="auth-brand" aria-hidden="true">
        <div className="auth-orbits"><span /><span /><span /></div>
        <div className="auth-brand-top"><span className="auth-brand-mark"><OrbisMark size={30} /></span><span className="auth-brand-word">Orbis</span></div>
        <div className="auth-brand-copy">
          <h2>Design spaces together.</h2>
          <p>A collaborative 3D room editor that understands space: it catches collisions, blocked paths and cramped corners, then helps you fix them.</p>
          <ul>
            <li><Users size={16} /> Share a link, edit live with anyone</li>
            <li><ShieldCheck size={16} /> Spatial checks on every change</li>
            <li><Sparkles size={16} /> AI layouts you can undo</li>
          </ul>
        </div>
        <small className="auth-brand-foot">Bit N Build · GDG On Campus FR.CRCE</small>
      </section>

      <main className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand"><span className="auth-brand-mark"><OrbisMark size={22} /></span><strong>Orbis</strong></div>
          {mode === "forgot" || mode === "reset" ? <button type="button" className="auth-back" onClick={() => go("login")}><ArrowLeft size={15} /> Back to log in</button> : null}
          <h1>{titles[mode][0]}</h1>
          <p className="auth-sub">{titles[mode][1]}</p>

          {done && mode === "forgot" ? (
            <div className="auth-success" role="status">
              <MailCheck size={20} />
              <div>
                <strong>Check your inbox</strong>
                <p>If an account exists for {email.trim()}, a reset link is on its way. It expires in 30 minutes.</p>
                {resetUrl ? <p className="auth-demo">Demo mode (no email service set up): <a href={resetUrl}>open the reset link</a></p> : null}
              </div>
            </div>
          ) : done && mode === "reset" ? (
            <div className="auth-success" role="status"><Check size={20} /><div><strong>Password updated</strong><p>Signing you in…</p></div></div>
          ) : (
            <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
              {error ? <div className="auth-alert" role="alert"><CircleAlert size={16} /> {error}</div> : null}
              {mode === "reset" && !token ? <div className="auth-alert" role="alert"><CircleAlert size={16} /> This reset link is incomplete. Request a new one.</div> : null}
              {mode === "signup" ? (
                <Field label="Full name" error={fieldErrors.name}>
                  <span className="auth-input"><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Your name" aria-invalid={!!fieldErrors.name || undefined} autoFocus required /></span>
                </Field>
              ) : null}
              {mode !== "reset" ? (
                <Field label="Email" error={fieldErrors.email}>
                  <span className="auth-input"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" aria-invalid={!!fieldErrors.email || undefined} autoFocus={mode !== "signup"} required /></span>
                </Field>
              ) : null}
              {mode !== "forgot" ? (
                <Field
                  label={mode === "reset" ? "New password" : "Password"}
                  error={fieldErrors.password}
                  hint={mode === "signup" || mode === "reset" ? <Strength password={password} /> : undefined}
                >
                  <PasswordInput value={password} onChange={setPassword} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "Your password" : "Create a password"} invalid={!!fieldErrors.password} />
                </Field>
              ) : null}
              {mode === "signup" || mode === "reset" ? (
                <Field label="Confirm password" error={fieldErrors.confirm}>
                  <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Type it again" invalid={!!fieldErrors.confirm} />
                </Field>
              ) : null}
              {mode === "login" ? (
                <div className="auth-row">
                  <label className="auth-check"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Keep me signed in</label>
                  <button type="button" className="auth-link" onClick={() => go("forgot")}>Forgot password?</button>
                </div>
              ) : null}
              <button type="submit" className="auth-submit" disabled={busy || (mode === "reset" && !token)}>
                {busy ? <Loader2 size={17} className="spin" /> : null}
                {mode === "login" ? (busy ? "Logging in…" : "Log in") : mode === "signup" ? (busy ? "Creating account…" : "Create account") : mode === "forgot" ? (busy ? "Sending…" : "Send reset link") : busy ? "Saving…" : "Update password"}
              </button>
              {(mode === "login" || mode === "signup") && config?.google ? (
                <>
                  <div className="auth-divider"><span>or</span></div>
                  <GoogleButton clientId={config.google} onError={setError} />
                </>
              ) : null}
            </form>
          )}

          {mode === "login" ? <p className="auth-switch">New to Orbis? <button type="button" className="auth-link" onClick={() => go("signup")}>Create an account</button></p> : null}
          {mode === "signup" ? <p className="auth-switch">Already have an account? <button type="button" className="auth-link" onClick={() => go("login")}>Log in</button></p> : null}
        </div>
      </main>
    </div>
  );
}
