import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { lazyEncryptPlugin } from "lazy-encrypt/vite";

// On GitHub Pages this app is served from a project sub-path
// (https://<user>.github.io/vite-lazy-encrypt/), so both Vite and the
// lazy-encrypt plugin need the matching `base`. Locally it stays at "/".
const base = process.env.DEMO_BASE || "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    // Pass the React plugin again so the encrypted page's JSX compiles in the
    // nested secret build, and the same `base` so the injected `.enc` URL is
    // resolved correctly on Pages.
    lazyEncryptPlugin({ plugins: [react()], base }),
  ],
});
