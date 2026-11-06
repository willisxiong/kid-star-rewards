import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Pages advanced mode: this adapter emits dist/_worker.js. Hono is mounted
// from Astro middleware for /api and /auth. A functions/ directory cannot
// coexist with that worker, so the API lives in the worker.
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
