# lazy-encrypt

[![npm version](https://img.shields.io/npm/v/lazy-encrypt.svg)](https://www.npmjs.com/package/lazy-encrypt)
[![license](https://img.shields.io/npm/l/lazy-encrypt.svg)](./LICENSE)
[![types](https://img.shields.io/npm/types/lazy-encrypt.svg)](./dist/index.d.ts)

Password-protect any page in your **Vite + React** app — no backend required.
Use it exactly like `React.lazy`:

```jsx
const Secret = lazyEncrypt(() => import("./SecretPage.jsx"));
```

One line to protect a route, one Vite plugin to wire up the build.

---

## Usage

Follow these four steps. There is nothing else to wire up.

### 1. Install

```sh
npm install lazy-encrypt
```

### 2. Add the plugin to `vite.config.js`

Pass your React plugin **twice** — once for your app, and again inside
`lazyEncryptPlugin` so the encrypted page's JSX compiles too.

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { lazyEncryptPlugin } from "lazy-encrypt/vite";

export default defineConfig({
  plugins: [
    react(),
    lazyEncryptPlugin({ plugins: [react()] }),
  ],
});
```

### 3. Write the page you want to protect

This is a normal component. **Two rules** (see [Requirements](#requirements)):
it must `export default`, and it must not import from the rest of your app or
use React hooks.

```jsx
// src/SecretPage.jsx
export default function SecretPage() {
  return <h1>The launch code is 0000</h1>;
}
```

### 4. Protect it with `lazyEncrypt`

Wrap a dynamic `import()` of that page. Use the result like any component.

```jsx
// src/App.jsx
import { lazyEncrypt } from "lazy-encrypt";

const SecretPage = lazyEncrypt(() => import("./SecretPage.jsx"));

export default function App() {
  return <SecretPage />;
}
```

`SecretPage` is just a React component — render it however you like. No router
is required, but it works with one too:

```jsx
// With react-router (optional):
<Route path="/secret" element={<SecretPage />} />

// Conditionally:
{showSecret && <SecretPage />}
```

That's it. `<SecretPage />` renders a password box; on the correct password it
swaps in the real page. For your own login UI instead of the default box, see
[Bring your own login field](#bring-your-own-login-field--uselazyencrypt).

---

## Build & run

**Development** — run Vite as usual. The protected page is served as plaintext
so you can edit it; any password unlocks.

```sh
npm run dev
```

**Production** — set `SECRET_PW` and build. Visitors need that password to see
the page.

```sh
SECRET_PW='your-password' npm run build
```

> `SECRET_PW` is read only at build time and is **never** included in the
> shipped files. (Do not rename it to start with `VITE_`, or Vite would leak it
> into the client.)

Serve the output like any static site:

```sh
npx serve dist
```

---

## Bring your own login field — `useLazyEncrypt`

For your own login UI instead of the default box, use the **`useLazyEncrypt`**
hook. It renders no UI — you supply the field and call `unlock(password)`.

```jsx
import { useState } from "react";
import { useLazyEncrypt } from "lazy-encrypt";

function Secret() {
  const { Component, unlock, busy, error, clearError } =
    useLazyEncrypt(() => import("./SecretPage.jsx"));
  const [password, setPassword] = useState("");

  if (Component) return <Component />;

  return (
    <form
      className="my-own-login"
      onSubmit={(e) => {
        e.preventDefault();
        unlock(password);
      }}
    >
      <input
        type="password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          clearError();
        }}
      />
      <button disabled={busy}>{busy ? "…" : "Unlock"}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

The hook returns `{ Component, unlock, busy, error, clearError, isProd }`.
`isProd` is `false` in dev (no ciphertext; any password unlocks).

### Options

Pass a second argument to `lazyEncrypt` or `useLazyEncrypt`:

| option         | description |
| -------------- | ----------- |
| `remember`     | `"session"` or `"local"` — reuse the password after a successful unlock. Stored in plaintext in the browser; cleared automatically if it stops working. |
| `onUnlocked`   | Callback after a successful unlock. |
| `fetchOptions` | Extra options forwarded to `fetch()` when loading the `.enc` blob. |

Do **not** pass `encUrl` — the Vite plugin injects it at build time.

```jsx
const SecretPage = lazyEncrypt(() => import("./SecretPage.jsx"), {
  remember: "local",
});
```

To clear a remembered password yourself:
`localStorage.removeItem("lazy-encrypt:" + encUrl)`.

---

## Requirements

The protected component must be **self-contained**, because it's bundled and
encrypted on its own:

1. **`export default` the component** — that's what gets rendered.
2. **No imports from the rest of your app** (shared components, stores, utils).
   Keep it standalone, or inline what it needs.
3. **No React hooks** (`useState`, `useEffect`, …). The encrypted bundle carries
   its own copy of React, and hooks would clash with your app's copy. Plain
   presentational JSX is fine.

Build-time needs: Vite ≥ 4, React ≥ 17, Node ≥ 18.

---

## What you're protecting against

**Protects:** the page's source code and the password are not in any shipped
file. Viewing source, downloading the bundle, or `curl`ing the site reveals only
encrypted bytes.

**Does not protect:** once someone unlocks with the right password, the
decrypted page is in their browser and can be extracted via devtools.

This is **client-side encryption, not authentication.** Everyone who should see
the page shares one password. If you need per-user access, logins, or to keep
the bytes from ever reaching the browser, put the page behind a real
authenticated server instead.

---

## How it works

In a production build the plugin finds each `lazyEncrypt(() => import("X"))` or
`useLazyEncrypt(() => import("X"))`, bundles `X` on its own, encrypts it to
`dist/<name>.enc`, and removes the plaintext from your main bundle. In the
browser, the runtime fetches that blob, derives a key from the password
(PBKDF2-SHA256, 250k iterations), decrypts it (AES-256-GCM), and renders the
result.

## License

MIT
