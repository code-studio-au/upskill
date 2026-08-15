import { createFileRoute } from "@tanstack/react-router";
import { scormLaunchInputSchema } from "#/features/scorm/scorm.schema";
import { getRequestUser } from "#/server/auth/session.server";
import { getServerEnv } from "#/server/env.server";
import {
  createEventScormLaunch,
  createScormLaunch,
} from "#/server/scorm/scorm-attempt.server";

const MAX_LAUNCH_BYTES = 1_024;
const noStoreHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/scorm/launches")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (
          request.headers.get("origin") !==
          new URL(getServerEnv().APP_ORIGIN).origin
        )
          return Response.json(
            { error: "invalid_origin" },
            { status: 403, headers: noStoreHeaders },
          );
        if (
          !request.headers.get("content-type")?.startsWith("application/json")
        )
          return Response.json(
            { error: "invalid_launch" },
            { status: 400, headers: noStoreHeaders },
          );
        const declaredLength = Number(request.headers.get("content-length"));
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > MAX_LAUNCH_BYTES
        ) {
          return Response.json(
            { error: "payload_too_large" },
            { status: 413, headers: noStoreHeaders },
          );
        }
        const rawBody = await request.text();
        if (Buffer.byteLength(rawBody, "utf8") > MAX_LAUNCH_BYTES)
          return Response.json(
            { error: "payload_too_large" },
            { status: 413, headers: noStoreHeaders },
          );
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(rawBody);
        } catch {
          return Response.json(
            { error: "invalid_launch" },
            { status: 400, headers: noStoreHeaders },
          );
        }
        const input = scormLaunchInputSchema.safeParse(parsedJson);
        if (!input.success)
          return Response.json(
            { error: "invalid_launch" },
            { status: 400, headers: noStoreHeaders },
          );
        const user = await getRequestUser();
        if (!user)
          return Response.json(
            { error: "unauthenticated" },
            { status: 401, headers: noStoreHeaders },
          );
        const result =
          "enrollmentId" in input.data
            ? await createScormLaunch(
                input.data.enrollmentId,
                input.data.modulePosition,
                user,
              )
            : await createEventScormLaunch(
                input.data.eventParticipationId,
                input.data.eventTemplateVersionItemId,
                user,
              );
        return Response.json(result, {
          status:
            result.status === "not-found"
              ? 404
              : result.status === "unavailable"
                ? 409
                : 200,
          headers: noStoreHeaders,
        });
      },
    },
  },
});
