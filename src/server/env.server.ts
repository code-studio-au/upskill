import "@tanstack/react-start/server-only";

import { parseServerEnvironment, type ServerEnv } from "./runtime-environment";

export type { ServerEnv } from "./runtime-environment";

let parsed: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (parsed) return parsed;
  parsed = parseServerEnvironment(process.env);
  return parsed;
}
