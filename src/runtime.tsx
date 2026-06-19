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
 */
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import { decrypt, MalformedBlobError, WrongPasswordError } from "./crypto.js";

/** Thrown when the `.enc` could not be fetched (e.g. served without a build). */
export class SecretNotBuiltError extends Error {}
export { WrongPasswordError, MalformedBlobError };

/** A module loader, as you'd pass to `React.lazy`. */
export type Loader<P = unknown> = () => Promise<{
  default: ComponentType<P>;
}>;

/** Options for {@link useLazyEncrypt} and {@link lazyEncrypt}. */
export interface UseLazyEncryptOptions {
  /**
   * URL of the encrypted blob. Injected automatically by the Vite plugin in
   * production builds; you normally never set this by hand.
   */
  encUrl?: string;
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
   * Default: off. The password is stored in plaintext in the browser; only
   * enable this if that is acceptable for your threat model. A stored password
   * that no longer works is cleared automatically.
   */
  remember?: "session" | "local";
}

/**
 * What {@link useLazyEncrypt} returns. The frontend renders and styles its own
 * login field, then passes the password through {@link unlock}.
 */
export interface LazyEncryptState<P = unknown> {
  /**
   * The decrypted component once unlocked, or `null` while still locked. Render
   * it yourself: `Component ? <Component {...props} /> : <YourLoginField />`.
   */
  Component: ComponentType<P> | null;
  /** Attempt to unlock with `password`. Pass the value from your own field. */
  unlock: (password: string) => void;
  /** True while a decrypt/import is in flight. */
  busy: boolean;
  /** Human-readable error from the last failed attempt, or "". */
  error: string;
  /** Clear the current error (e.g. on field change). */
  clearError: () => void;
  /** False in dev mode (no ciphertext; any password unlocks). */
  isProd: boolean;
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
 * The login primitive. Drives the decrypt/import lifecycle but renders no UI —
 * the frontend supplies and styles its own login field and passes the password
 * through {@link LazyEncryptState.unlock}.
 *
 *   function Secret() {
 *     const { Component, unlock, busy, error } =
 *       useLazyEncrypt(() => import("./secret-page"));
 *     if (Component) return <Component />;
 *     return (
 *       <form onSubmit={(e) => { e.preventDefault(); unlock(pw); }}>
 *         <input value={pw} onChange={(e) => setPw(e.target.value)} />
 *         <button disabled={busy}>Unlock</button>
 *         {error && <p>{error}</p>}
 *       </form>
 *     );
 *   }
 */
export function useLazyEncrypt<P = Record<string, unknown>>(
  loader: Loader<P> | null,
  options: UseLazyEncryptOptions = {},
): LazyEncryptState<P> {
  const { encUrl, fetchOptions, onUnlocked, remember } = options;
  const isProd = Boolean(encUrl);

  const [Comp, setComp] = useState<ComponentType<P> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Where (if anywhere) to persist the password. Keyed by encUrl so multiple
  // protected pages don't collide. All access is wrapped in try/catch because
  // web storage can throw (private mode, disabled cookies, SSR).
  const storage = useMemo(() => {
    const store =
      remember === "local"
        ? "localStorage"
        : remember === "session"
          ? "sessionStorage"
          : null;
    const storeKey = `lazy-encrypt:${encUrl ?? ""}`;
    return {
      recall: (): string | null => {
        if (!store || !encUrl) return null;
        try { return globalThis[store]?.getItem(storeKey) ?? null; } catch { return null; }
      },
      persist: (pw: string) => {
        if (!store || !encUrl) return;
        try { globalThis[store]?.setItem(storeKey, pw); } catch { /* ignore */ }
      },
      forget: () => {
        if (!store) return;
        try { globalThis[store]?.removeItem(storeKey); } catch { /* ignore */ }
      },
    };
  }, [remember, encUrl]);

  // `silent` suppresses the error UI for the auto-unlock attempt on mount, so a
  // stale saved password just falls back to a clean field instead of a scary
  // "Wrong password" on load.
  const attempt = useCallback(
    async (pw: string, silent = false) => {
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
        storage.persist(pw); // remember it (no-op unless `remember` set)
        onUnlocked?.();
      } catch (e) {
        storage.forget(); // a saved password that failed is wrong/stale — drop it
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isProd, encUrl, fetchOptions, onUnlocked, loader, storage],
  );

  const unlock = useCallback((password: string) => attempt(password), [attempt]);
  const clearError = useCallback(() => setError(""), []);

  // On mount, if a password was remembered, unlock automatically.
  useEffect(() => {
    const saved = storage.recall();
    if (saved) attempt(saved, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    Component: Comp,
    unlock,
    busy,
    error,
    clearError,
    isProd,
  };
}

/**
 * Wrap a dynamic import in a password gate. Returns a component that renders the
 * gate until unlocked, then the decrypted (prod) or plaintext (dev) default
 * export of the target module.
 *
 * Built on {@link useLazyEncrypt}. For full control over how the login field is
 * rendered and styled, call that hook directly instead.
 */
export function lazyEncrypt<P = Record<string, unknown>>(
  loader: Loader<P> | null,
  options: UseLazyEncryptOptions = {},
): ComponentType<P> {
  return function LazyEncryptGate(props: P) {
    const { Component: Comp, unlock, busy, error, clearError, isProd } =
      useLazyEncrypt<P>(loader, options);
    const [password, setPassword] = useState("");

    const submit = useCallback(() => unlock(password), [unlock, password]);

    if (Comp) {
      return createElement(
        Comp as ComponentType<unknown>,
        props as Record<string, unknown>,
      );
    }

    return (
      <section className="lazy-encrypt-gate">
        <h1>Locked</h1>
        <p>Enter the password to unlock the protected page.</p>
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
            clearError();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          disabled={busy}
        />
        <button onClick={submit} disabled={busy}>
          {busy ? "…" : "Unlock"}
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  };
}
