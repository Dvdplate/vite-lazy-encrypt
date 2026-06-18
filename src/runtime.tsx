/**
 * lazy-encrypt — runtime (browser / React).
 *
 * `lazyEncrypt` is a `React.lazy`-style helper for a password-encrypted,
 * lazily-loaded route or component:
 *
 *   const Secret = lazyEncrypt(() => import("./secret-page"));
 *   <Route path="/secret" element={<Secret />} />
 *
 * Dev (`vite`)        : no `.enc` exists, so the loader imports the real
 *                       plaintext module — the page works with no build. The
 *                       password cannot be verified, so any input unlocks (a
 *                       notice says so).
 * Prod (`vite build`) : the companion plugin (`lazy-encrypt/vite`) rewrites the
 *                       call to inject `{ encUrl }`, builds + encrypts the
 *                       target into `<name>.enc`, and keeps the plaintext out of
 *                       the main bundle. Unlock fetches the `.enc` and decrypts
 *                       it in the browser with the user's password.
 *
 * THREAT MODEL — this is client-side encryption, NOT server authentication.
 * After a correct unlock the decrypted module lives in browser memory and is
 * recoverable via devtools. It protects only the shipped static bytes: the file
 * on disk is ciphertext and the password appears in no file. For real access
 * control, gate the encrypted bytes behind a server that checks auth first.
 */
import {
  createElement,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { decrypt, MalformedBlobError, WrongPasswordError } from "./crypto.js";

/** Thrown when the `.enc` could not be fetched (e.g. served without a build). */
export class SecretNotBuiltError extends Error {}
export { WrongPasswordError, MalformedBlobError };

/** A module loader, as you'd pass to `React.lazy`. */
export type Loader<P = unknown> = () => Promise<{
  default: ComponentType<P>;
}>;

/** Render-prop state handed to a custom `gate`. */
export interface GateState {
  /** Current password input value. */
  password: string;
  /** Update the password input. */
  setPassword: (value: string) => void;
  /** Attempt to unlock with the current password. */
  unlock: () => void;
  /** True while a decrypt/import is in flight. */
  busy: boolean;
  /** Human-readable error from the last failed attempt, or "". */
  error: string;
  /** False in dev mode (no ciphertext; any password unlocks). */
  isProd: boolean;
}

export interface LazyEncryptOptions {
  /**
   * URL of the encrypted blob. Injected automatically by the Vite plugin in
   * production builds; you normally never set this by hand.
   */
  encUrl?: string;
  /** Gate heading. Default: "Locked". */
  title?: ReactNode;
  /** Gate prompt text. */
  prompt?: ReactNode;
  /** Unlock button label. Default: "Unlock". */
  buttonLabel?: ReactNode;
  /** Class name applied to the default gate's root `<section>`. */
  className?: string;
  /** Extra options forwarded to `fetch()` when retrieving the blob. */
  fetchOptions?: RequestInit;
  /** Called once with the decrypted component after a successful unlock. */
  onUnlocked?: () => void;
  /**
   * Remember the password so the visitor only types it once. After a successful
   * unlock the password is saved in web storage and reused automatically on the
   * next visit (or page reload), skipping the prompt.
   *
   *   "session" — kept until the browser tab is closed (sessionStorage).
   *   "local"   — kept across tabs and restarts (localStorage).
   *
   * Default: off (the prompt shows every time). The password is stored in
   * plaintext in the browser; only enable this if that is acceptable for your
   * threat model. A stored password that no longer works is cleared
   * automatically.
   */
  remember?: "session" | "local";
  /**
   * Fully replace the default gate UI. Receives the live {@link GateState} and
   * returns whatever you want to render before the protected component is
   * unlocked.
   */
  gate?: (state: GateState) => ReactNode;
}

async function loadEncrypted<P>(
  encUrl: string,
  password: string,
  fetchOptions?: RequestInit,
): Promise<ComponentType<P>> {
  const res = await fetch(encUrl, fetchOptions);
  if (!res.ok) {
    throw new SecretNotBuiltError(`encrypted bundle missing (${res.status}).`);
  }

  const blob = new Uint8Array(await res.arrayBuffer());
  const plain = await decrypt(blob, password); // throws WrongPasswordError on bad pw

  const url = URL.createObjectURL(
    new Blob([plain as BlobPart], { type: "text/javascript" }),
  );
  try {
    const mod = await import(/* @vite-ignore */ url);
    return mod.default as ComponentType<P>;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Wrap a dynamic import in a password gate. Returns a component that renders the
 * gate until unlocked, then the decrypted (prod) or plaintext (dev) default
 * export of the target module.
 */
export function lazyEncrypt<P = Record<string, unknown>>(
  loader: Loader<P> | null,
  options: LazyEncryptOptions = {},
): ComponentType<P> {
  const {
    encUrl,
    title = "Locked",
    prompt,
    buttonLabel = "Unlock",
    className = "lazy-encrypt-gate",
    fetchOptions,
    onUnlocked,
    gate,
    remember,
  } = options;
  const isProd = Boolean(encUrl);

  // Where (if anywhere) to persist the password. Keyed by encUrl so multiple
  // protected pages don't collide. All access is wrapped in try/catch because
  // web storage can throw (private mode, disabled cookies, SSR).
  const store = remember === "local" ? "localStorage" : remember === "session" ? "sessionStorage" : null;
  const storeKey = `lazy-encrypt:${encUrl ?? ""}`;
  const recall = (): string | null => {
    if (!store || !encUrl) return null;
    try { return globalThis[store]?.getItem(storeKey) ?? null; } catch { return null; }
  };
  const persist = (pw: string) => {
    if (!store || !encUrl) return;
    try { globalThis[store]?.setItem(storeKey, pw); } catch { /* ignore */ }
  };
  const forget = () => {
    if (!store) return;
    try { globalThis[store]?.removeItem(storeKey); } catch { /* ignore */ }
  };

  return function LazyEncryptGate(props: P) {
    const [Comp, setComp] = useState<ComponentType<P> | null>(null);
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    // `silent` suppresses the error UI for the auto-unlock attempt on mount, so
    // a stale saved password just falls back to a clean prompt instead of a
    // scary "Wrong password" on load.
    const attempt = useCallback(async (pw: string, silent = false) => {
      setBusy(true);
      if (!silent) setError("");
      try {
        let C: ComponentType<P>;
        if (isProd) {
          C = await loadEncrypted<P>(encUrl!, pw, fetchOptions);
        } else if (loader) {
          // Dev: no ciphertext exists; load the real module. The password is
          // not verifiable here, so any input unlocks. Documented behavior.
          C = (await loader()).default;
        } else {
          throw new SecretNotBuiltError(
            "no encUrl and no dev loader — nothing to load.",
          );
        }
        setComp(() => C);
        persist(pw); // remember it for next time (no-op unless `remember` set)
        onUnlocked?.();
      } catch (e) {
        forget(); // a saved password that failed is wrong/stale — drop it
        if (silent) return;
        if (e instanceof SecretNotBuiltError) {
          setError("Encrypted bundle not built — run the production build.");
        } else if (e instanceof WrongPasswordError) {
          setError("Wrong password");
        } else if (e instanceof MalformedBlobError) {
          setError("Encrypted bundle is corrupt or not in the expected format.");
        } else {
          // Decrypt succeeded but the module failed to load/evaluate. Don't
          // mislabel as a wrong password — surface the real error.
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[lazyEncrypt] failed to load decrypted module:", e);
          setError(`Failed to load protected page: ${msg}`);
        }
      } finally {
        setBusy(false);
      }
    }, []);

    const unlock = useCallback(() => attempt(password), [attempt, password]);

    // On mount, if a password was remembered, unlock automatically.
    useEffect(() => {
      const saved = recall();
      if (saved) attempt(saved, true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (Comp) {
      return createElement(
        Comp as ComponentType<unknown>,
        props as Record<string, unknown>,
      );
    }

    if (gate) {
      return (
        <>{gate({ password, setPassword, unlock, busy, error, isProd })}</>
      );
    }

    return (
      <section className={className}>
        <h1>{title}</h1>
        <p>{prompt ?? "Enter the password to unlock the protected page."}</p>
        {!isProd && (
          <p role="note">
            Dev mode: serving plaintext; any password unlocks. Run a production
            build to exercise real decryption.
          </p>
        )}
        <input
          type="password"
          value={password}
          placeholder="Password"
          autoComplete="off"
          onChange={(e) => {
            setPassword(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") unlock();
          }}
          disabled={busy}
        />
        <button onClick={unlock} disabled={busy}>
          {busy ? "…" : buttonLabel}
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  };
}
