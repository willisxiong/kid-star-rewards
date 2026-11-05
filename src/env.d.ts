/// <reference types="astro/client" />

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}

interface Env {
  DB: import('./server/d1').D1Database;
  SESSION_SECRET?: string;
  MAGIC_LINK_DEV_ECHO?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  MAILCHANNELS?: string;
  APP_ORIGIN?: string;
}
