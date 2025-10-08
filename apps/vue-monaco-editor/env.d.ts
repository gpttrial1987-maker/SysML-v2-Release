/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VALIDATION_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
