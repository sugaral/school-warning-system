import { createApp } from 'vue';
import 'element-plus/dist/index.css';
import './styles/theme.css';
import './styles/page-layout.css';
import App from './App.vue';
import { preloadAppCaches } from './bootstrap-preload';
import { isDynamicImportError, reloadForDynamicImportError } from './lib/dynamic-import-recovery';
import { initResponsiveTableEnhancer } from './lib/responsive-table';
import { router } from './router';
import pinia from './stores';

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  reloadForDynamicImportError();
});

window.addEventListener('unhandledrejection', (event) => {
  if (!isDynamicImportError(event.reason)) {
    return;
  }

  event.preventDefault();
  reloadForDynamicImportError();
});

async function bootstrap() {
  await preloadAppCaches();

  const app = createApp(App);
  app.use(pinia);
  app.use(router);
  app.mount('#app');
  initResponsiveTableEnhancer();
}

void bootstrap();

