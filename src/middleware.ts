import { defineMiddleware } from 'astro:middleware';
import { errorText, localeFromCookieHeader } from './lib/i18n';
import { app } from './server/app';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = new URL(context.request.url);
  if (pathname.startsWith('/api/') || pathname === '/auth/verify') {
    const runtime = context.locals.runtime;
    if (!runtime?.env?.DB) {
      const locale = localeFromCookieHeader(context.request.headers.get('cookie'));
      return Response.json({ error: 'misconfigured', message: errorText(locale, 'dbMissing') }, { status: 500 });
    }
    return app.fetch(context.request, runtime.env, runtime.ctx);
  }
  return next();
});
