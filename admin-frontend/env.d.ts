/// <reference types="vite/client" />

declare module 'echarts' {
  export function init(dom: HTMLElement | null): any;
  export function use(components: any[]): void;
  export const version: string;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

