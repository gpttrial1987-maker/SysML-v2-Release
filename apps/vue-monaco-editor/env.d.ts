/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VALIDATION_URL?: string;
  readonly VITE_SYSML_API_URL?: string;
  readonly VITE_SYSML_PROJECT_ID?: string;
  readonly VITE_SYSML_COMMIT_ID?: string;
  readonly VITE_SYSML_ROOT_ELEMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
