import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Workers + static assets. This adapter emits dist/_worker.js/index.js, which
// wrangler.jsonc uses as `main`, and a Pages-style _routes.json. Workers does
// not route with _routes.json; public/.assetsignore keeps both files out of
// the asset upload. Hono is mounted from Astro middleware for /api and /auth.
export default defineConfig({
  output: 'server',
  // Our own D1 sessions. A memory driver stops the adapter from requiring a KV binding.
  session: {
    driver: 'memory',
  },
  adapter: cloudflare({
    imageService: 'passthrough',
    platformProxy: {
      enabled: true,
    },
    routes: {
      extend: {
        include: [{ pattern: '/api/*' }, { pattern: '/auth/*' }],
      },
    },
  }),
});
