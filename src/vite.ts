/**
 * lazy-encrypt — Vite build plugin (`lazy-encrypt/vite`).
 *
 * Companion to the `lazyEncrypt` runtime. It:
 *   1. Discovers `lazyEncrypt(() => import("X"))` calls in your source.
 *   2. In a production build, for each target X:
 *        - runs a nested, self-contained lib build (its own React bundled in),
 *        - encrypts the result with PBKDF2 -> AES-GCM (see ./crypto),
 *        - writes `<name>.enc` into the output dir,
 *        - rewrites the call to `lazyEncrypt(null, { encUrl: "/<name>.enc" })`
 *          so the plaintext target never enters the main bundle graph.
 *   3. In dev it does nothing — the real `import("X")` is served as plaintext.
 *
 * The `.enc` blob is self-describing (the KDF iteration count is encoded in its
 * header), so the runtime needs no out-of-band configuration to decrypt it.
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { build, type Plugin, type PluginOption } from "vite";
import { encrypt, DEFAULT_ITERATIONS } from "./crypto.js";

// Matches `lazyEncrypt( () => import('X') )` with single/double/back quotes and
// arbitrary inner whitespace. Intentionally conservative: only the no-arg arrow
// + bare dynamic-import form (the documented usage) is rewritten.
const CALL_RE =
  /lazyEncrypt\(\s*(?:async\s*)?\(\s*\)\s*=>\s*import\(\s*(['"`])([^'"`]+)\1\s*\)\s*\)/g;

const PROCESSABLE = /\.(?:[cm]?jsx?|tsx?)$/;

export interface LazyEncryptPluginOptions {
  /**
   * Build-time encryption password. Defaults to `process.env[envVar]`.
   * Required for production builds; the build fails loudly if unset.
   */
  password?: string;
  /**
   * Name of the environment variable read when `password` is omitted.
   * Default: `"SECRET_PW"`. Note: it must NOT have a `VITE_` prefix, or Vite
   * would inline it into client code.
   */
  envVar?: string;
  /**
   * Vite plugins used for the nested secret build. Pass the same framework
   * plugin(s) your app uses, e.g. `[react()]`, so JSX/TSX targets compile.
   */
  plugins?: PluginOption[];
  /**
   * PBKDF2 iteration count. Encoded into each `.enc`, so the runtime stays in
   * sync automatically. Default: 250000.
   */
  iterations?: number;
  /**
   * Base path prepended to each generated `encUrl`. Default: `"/"`. Set this if
   * your app is served from a sub-path (matches Vite's `base`).
   */
  base?: string;
}

export function lazyEncryptPlugin(
  options: LazyEncryptPluginOptions = {},
): Plugin {
  const {
    envVar = "SECRET_PW",
    plugins = [],
    iterations = DEFAULT_ITERATIONS,
    base = "/",
  } = options;
  const password = options.password ?? process.env[envVar];

  // resolved entry id -> enc file name (e.g. "secret-page.enc")
  const entries = new Map<string, string>();
  let isBuild = false;
  let root = process.cwd();
  let outDir = "dist";

  const urlBase = base.endsWith("/") ? base : base + "/";

  return {
    name: "vite-plugin-lazy-encrypt",
    enforce: "pre", // run before the JSX transform so we rewrite the raw import()

    configResolved(config) {
      isBuild = config.command === "build";
      root = config.root;
      outDir = config.build.outDir;
      if (isBuild && !password) {
        throw new Error(
          `[lazy-encrypt] ${envVar} not set. Run: ${envVar}='your-password' vite build`,
        );
      }
    },

    async transform(code, id) {
      if (!code.includes("lazyEncrypt(") || !PROCESSABLE.test(id)) return null;

      CALL_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      const rewrites: Array<[string, string]> = [];
      while ((match = CALL_RE.exec(code))) {
        const [whole, , spec] = match;
        const resolved = await this.resolve(spec, id);
        if (!resolved) continue;
        const encName = basename(spec, extname(spec)) + ".enc";
        entries.set(resolved.id, encName);
        if (isBuild) {
          const encUrl = urlBase + encName;
          rewrites.push([
            whole,
            `lazyEncrypt(null, { encUrl: ${JSON.stringify(encUrl)} })`,
          ]);
        }
      }

      if (!isBuild || rewrites.length === 0) return null;

      let out = code;
      for (const [from, to] of rewrites) out = out.split(from).join(to);
      // Dropping the loader removes the dynamic import, so the target never
      // enters the bundle graph. Sourcemap omitted; downstream plugins re-map.
      return { code: out, map: null };
    },

    async closeBundle() {
      if (!isBuild || entries.size === 0) return;

      const tmp = resolve(root, ".lazy-encrypt-tmp");
      const outAbs = resolve(root, outDir);
      await mkdir(outAbs, { recursive: true });

      try {
        for (const [entryId, encName] of entries) {
          // Nested, isolated lib build of the secret module (own React bundled).
          await build({
            configFile: false,
            root,
            logLevel: "warn",
            mode: "production",
            // The nested build doesn't inherit the app's env replacement, so
            // bundled deps keep literal `process.env.NODE_ENV`. `process` is
            // undefined in the browser, so the decrypted module would throw a
            // ReferenceError on import. Replace it so it constant-folds away.
            define: { "process.env.NODE_ENV": JSON.stringify("production") },
            plugins,
            build: {
              outDir: tmp,
              emptyOutDir: true,
              lib: {
                entry: entryId,
                formats: ["es"],
                fileName: () => "mod.js",
              },
            },
          });

          const plaintext = await readFile(resolve(tmp, "mod.js"));
          const blob = await encrypt(
            new Uint8Array(plaintext),
            password!,
            iterations,
          );
          await writeFile(resolve(outAbs, encName), blob);
          this.info?.(`encrypted -> ${outDir}/${encName}`);
        }
      } finally {
        await rm(tmp, { recursive: true, force: true });
        entries.clear();
      }
    },
  };
}

export default lazyEncryptPlugin;
export type { LazyEncryptPluginOptions as PluginOptions };
