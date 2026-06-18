/**
 * lazy-encrypt — default entry (browser / React runtime).
 *
 * The build plugin lives at the `lazy-encrypt/vite` subpath so that importing
 * the runtime never pulls Node-only code into your client bundle.
 */
export {
  lazyEncrypt,
  useLazyEncrypt,
  SecretNotBuiltError,
  WrongPasswordError,
  MalformedBlobError,
} from "./runtime.js";
export type {
  Loader,
  GateState,
  LazyEncryptState,
  LazyEncryptOptions,
  UseLazyEncryptOptions,
} from "./runtime.js";
