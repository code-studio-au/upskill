import { randomBytes } from "node:crypto";
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { getServerEnv } from "#/server/env.server";
import { applySecurityHeaders } from "#/server/http/security-headers";
import { handleOfflineScormPackageHostRequest } from "#/server/scorm/offline-scorm-package-host.server";
import { handleOfflineScormLearningRuntimeRequest } from "#/server/scorm/offline-scorm-runtime-assets.server";

const fetch = createStartHandler(async (context) => {
  const packageHostResponse = await handleOfflineScormPackageHostRequest(
    context.request,
  );
  if (packageHostResponse) return packageHostResponse;
  const offlineRuntimeResponse = await handleOfflineScormLearningRuntimeRequest(
    context.request,
  );
  if (offlineRuntimeResponse) return offlineRuntimeResponse;
  const nonce = randomBytes(24).toString("base64url");
  context.router.update({ ssr: { nonce } });

  const result = await defaultStreamHandler(context);
  const response = result instanceof Response ? result : result.response;
  const headers = new Headers(response.headers);
  const environment = getServerEnv();
  applySecurityHeaders(headers, nonce, context.request, {
    ...(environment.LIVEKIT_ENABLED && environment.LIVEKIT_URL
      ? { liveKitWebsocketUrl: environment.LIVEKIT_URL }
      : {}),
  });

  const securedResponse = new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
  return result instanceof Response
    ? securedResponse
    : { ...result, response: securedResponse };
});

export default { fetch };
