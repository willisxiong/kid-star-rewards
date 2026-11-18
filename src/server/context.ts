import type { ResolvedSessions } from './sessions';

export type AppEnv = {
  Bindings: Env;
  Variables: { sessions?: ResolvedSessions };
};
