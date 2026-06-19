// The protected page. It is bundled and encrypted on its own, so it must be
// self-contained: `export default`, no imports from the rest of the app, and no
// React hooks. Plain presentational JSX only. (See the lazy-encrypt README.)
export default function SecretPage() {
  return (
    <div className="secret">
      <h1>🔓 Unlocked</h1>
      <p>
        You're now looking at <code>SecretPage.jsx</code> — code that was{" "}
        <strong>never in the shipped bundle</strong>. It arrived as an encrypted
        AES-256-GCM blob and was decrypted in your browser with the password you
        just typed.
      </p>
      <p>
        Open DevTools → Network and reload: you'll see a <code>.enc</code> file
        of opaque bytes. View source on the main bundle and this text isn't
        there. That's the whole point.
      </p>
      <p className="codeword">The launch code is 0000.</p>
    </div>
  );
}
