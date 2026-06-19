# lazy-encrypt — live demo

A minimal Vite + React app that password-protects a page with
[`lazy-encrypt`](https://www.npmjs.com/package/lazy-encrypt). It consumes the
published package exactly as a real consumer would.

**Live:** https://dvdplate.github.io/vite-lazy-encrypt/ · **Password:** `opensesame`

## Run it locally

```sh
npm install

# Dev — page served as plaintext, any password unlocks (documented dev behavior)
npm run dev

# Production — encrypts the page; only the real password unlocks
SECRET_PW='opensesame' npm run build
npm run preview
```

After a production build, look in `dist/`: `SecretPage.enc` is the encrypted
blob, and the secret text in `SecretPage.jsx` appears nowhere in the main JS
bundle.

## What to look at

- [`src/App.jsx`](src/App.jsx) — one line gates the page: `lazyEncrypt(() => import("./SecretPage.jsx"))`.
- [`src/SecretPage.jsx`](src/SecretPage.jsx) — the protected, self-contained component.
- [`vite.config.js`](vite.config.js) — the `lazyEncryptPlugin` wiring.
