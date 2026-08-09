import { randomBytes } from "node:crypto";
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { applySecurityHeaders } from "#/server/http/security-headers";

const fetch = createStartHandler(async (context) => {
  const nonce = randomBytes(24).toString("base64url");
  context.router.update({ ssr: { nonce } });

  const result = await defaultStreamHandler(context);
  const response = result instanceof Response ? result : result.response;
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers, nonce, context.request);

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
