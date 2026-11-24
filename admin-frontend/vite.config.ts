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

const BACKEND = 'http://localhost:3000';

/**
 * 代理到后端，但把「浏览器导航」放行给 SPA。
 *
 * 前端路由与后端接口存在同名前缀（/warnings、/students、/attendance、
 * /reports、/users、/orgs、/courses …）。如果不区分请求类型，直接刷新
 * 或收藏这些路由时请求会被代理到后端，页面变成一段 JSON（401
 * "Missing authentication token"）。生产 nginx 已按 Accept 头做了区分
 * （text/html → index.html），这里保持一致。
 */
function apiProxy(rewrite?: (path: string) => string) {
  return {
    target: BACKEND,
    changeOrigin: true,
    ...(rewrite ? { rewrite } : {}),
    bypass(req: any) {
      const accept = String(req?.headers?.accept || '');
      if (accept.includes('text/html')) return '/index.html';
      return undefined;
    },
  };
}

const proxyMap: Record<string, any> = {
  '/api': apiProxy((path: string) => path.replace(/^\/api/, '')),
};

// 其余后端前缀（与后端 controller 路由一一对应）
for (const prefix of [
  '/admin',
  '/auth',
  '/orgs',
  '/student',
  '/warnings',
  '/warning-cases',
  '/leave_requests',
  '/makeup_requests',
  '/appeals',
  '/attendance',
  '/schedules',
  '/jobs',
  '/warning-rules',
  '/courses',
  '/student-admin',
  '/teaching-admin',
  '/teacher',
  '/vice-dean',
  '/head-teacher',
  '/class-monitor',
  '/classes',
  '/teachers',
  '/students',
  '/reports',
  '/audit',
  '/stats',
  '/config',
  '/users',
  '/course-classes',
  '/health',
  '/requests',
  '/permission',
  '/role',
  '/feedback',
  '/files',
  '/uploads',
]) {
  proxyMap[prefix] = apiProxy();
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd());

  return {
    plugins: [
      vue(),
      Components({
        dts: command === 'serve',
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
      proxy: proxyMap,
    },
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL || ''),
    },
  };
});
