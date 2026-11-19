import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { webcrypto } from 'crypto';

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());

  return {
    plugins: [
      vue(),
      Components({
        resolvers: [ElementPlusResolver({ importStyle: false })],
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }

            if (id.includes('echarts')) {
              return 'vendor-echarts';
            }

            if (id.includes('@element-plus/icons-vue')) {
              return 'vendor-element-icons';
            }

            if (
              id.includes('dayjs') ||
              id.includes('async-validator') ||
              id.includes('lodash-unified') ||
              id.includes('@floating-ui')
            ) {
              return 'vendor-element-plus-deps';
            }

            if (id.includes('element-plus')) {
              return 'vendor-element-plus';
            }

            if (id.includes('vue-router')) {
              return 'vendor-router';
            }

            if (id.includes('pinia')) {
              return 'vendor-pinia';
            }

            if (id.includes('axios')) {
              return 'vendor-axios';
            }

            return 'vendor-misc';
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/admin': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/auth': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/orgs': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/student': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/warnings': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/warning-cases': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/leave_requests': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/makeup_requests': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/appeals': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/attendance': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/schedules': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/jobs': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/warning-rules': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/courses': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/student-admin': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/teaching-admin': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/teacher': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/vice-dean': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/head-teacher': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/class-monitor': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/classes': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/teachers': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/students': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/reports': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/audit': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/stats': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/config': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/users': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/course-classes': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/health': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/requests': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/permission': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/role': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/feedback': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/files': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/uploads': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL || ''),
    },
  };
});
