# lazy-encrypt

Password-protect a page in your React app. The page's code is **encrypted at
build time** and never ships as readable source — it's decrypted in the browser
only after the visitor types the correct password.

`lazyEncrypt` works exactly like `React.lazy`, so protecting a page is a one-line
change.

```jsx
const Secret = lazyEncrypt(() => import("./SecretPage.jsx"));
```

Built for **Vite + React**. Uses the browser's built-in WebCrypto (PBKDF2 →
AES-256-GCM). No backend required.

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
swaps in the real page.

---

## Build & run

**Development** — just run Vite. The page loads as plaintext so you can work on
it normally. There's no real password in dev, so **any password unlocks** (the
box says so).

```sh
npm run dev
```

**Production** — set the password as an environment variable named `SECRET_PW`
and build. Anyone visiting the site needs this password to see the page.

```sh
SECRET_PW='your-password' npm run build
```

> `SECRET_PW` is read only at build time and is **never** included in the
> shipped files. (Do not rename it to start with `VITE_`, or Vite would leak it
> into the client.)

Serve the output like any static site and open the protected route:

```sh
npx serve dist
```

You should see a password box. Enter the password from your build → the page
appears. Wrong password → "Wrong password", and the real code stays encrypted.

---

## Customizing the password box (optional)

Pass a second argument to style the default box or replace it entirely.

```jsx
// Tweak the text / class:
const SecretPage = lazyEncrypt(() => import("./SecretPage.jsx"), {
  title: "Members only",
  prompt: "Enter your access code",
  buttonLabel: "Enter",
  className: "my-gate",
});

// Or render your own UI with the `gate` render-prop:
const SecretPage = lazyEncrypt(() => import("./SecretPage.jsx"), {
  gate: ({ password, setPassword, unlock, busy, error }) => (
    <form onSubmit={(e) => { e.preventDefault(); unlock(); }}>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button disabled={busy}>Unlock</button>
      {error && <p>{error}</p>}
    </form>
  ),
});
```

All options: `title`, `prompt`, `buttonLabel`, `className`, `gate`,
`onUnlocked()`, `fetchOptions`, `remember`. Do **not** pass `encUrl` — the
plugin injects it.

---

## Remembering the password (optional)

Add `remember` so visitors type the password **once** — it's reused
automatically on reloads and return visits, skipping the prompt.

```jsx
const SecretPage = lazyEncrypt(() => import("./SecretPage.jsx"), {
  remember: "local", // or "session"
});
```

| value       | the password is kept…                                  |
| ----------- | ------------------------------------------------------ |
| `"session"` | until the browser tab is closed (`sessionStorage`)     |
| `"local"`   | across tabs and restarts (`localStorage`)              |
| *(omitted)* | not at all — the prompt shows every time (default)     |

A remembered password that no longer works (e.g. you rebuilt with a new one) is
cleared automatically, and the visitor just sees the prompt again.

> **Note:** the password is stored in plaintext in the browser, so anyone with
> access to that device can read it. Use `"session"` (or leave it off) if that
> matters. To clear it yourself: `localStorage.removeItem("lazy-encrypt:" + encUrl)`.

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

In a production build the plugin finds each `lazyEncrypt(() => import("X"))`,
bundles `X` on its own, encrypts it to `dist/<name>.enc`, and removes the
plaintext from your main bundle. In the browser, `lazyEncrypt` fetches that
`.enc`, derives a key from the password (PBKDF2-SHA256, 250k iterations),
decrypts it (AES-256-GCM), and renders the result. A wrong password fails the
cipher's built-in authentication check, so it's rejected cleanly.

## License

MIT
