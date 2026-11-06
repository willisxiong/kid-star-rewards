import { defineMiddleware } from 'astro:middleware';
import { app } from './server/app';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = new URL(context.request.url);
  if (pathname.startsWith('/api/') || pathname === '/auth/verify') {
    const runtime = context.locals.runtime;
    if (!runtime?.env?.DB) {
      return Response.json({ error: 'misconfigured', message: 'D1 binding DB is missing' }, { status: 500 });
    }
    return app.fetch(context.request, runtime.env, runtime.ctx);
  }
  return next();
});
