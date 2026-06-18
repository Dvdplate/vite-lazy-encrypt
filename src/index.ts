/**
 * lazy-encrypt — default entry (browser / React runtime).
 *
 * The build plugin lives at the `lazy-encrypt/vite` subpath so that importing
 * the runtime never pulls Node-only code into your client bundle.
 */
export {
  lazyEncrypt,
  SecretNotBuiltError,
  WrongPasswordError,
  MalformedBlobError,
} from "./runtime.js";
export type {
  Loader,
  GateState,
  LazyEncryptOptions,
} from "./runtime.js";
