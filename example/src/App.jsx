import { lazyEncrypt } from "lazy-encrypt";

// One line to gate a route. In the production build the lazy-encrypt Vite
// plugin pulls SecretPage out of the main bundle, encrypts it to a .enc blob,
// and injects the URL here automatically.
const SecretPage = lazyEncrypt(() => import("./SecretPage.jsx"));

// Public demo password, baked in at build time via SECRET_PW. Shown on purpose
// so anyone can try it — in a real app you'd never publish the password.
const DEMO_PASSWORD = "opensesame";

export default function App() {
  return (
    <main className="page">
      <header>
        <h1>lazy-encrypt</h1>
        <p className="tagline">
          Password-protect a page in a Vite + React app — no backend. The
          plaintext source never ships; only an encrypted blob, decrypted in the
          browser after the right password.
        </p>
        <nav className="links">
          <a href="https://www.npmjs.com/package/lazy-encrypt">npm</a>
          <a href="https://github.com/Dvdplate/vite-lazy-encrypt">GitHub</a>
        </nav>
      </header>

      <section className="hint">
        Try the password: <code>{DEMO_PASSWORD}</code>
      </section>

      <section className="demo">
        <SecretPage />
      </section>

      <footer>
        <p>
          The component below this line is fetched as ciphertext and decrypted
          client-side with PBKDF2-SHA256 → AES-256-GCM. Wrong password → it
          stays locked.
        </p>
      </footer>
    </main>
  );
}
