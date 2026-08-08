import http from "node:http";
import { Readable } from "node:stream";
import application from "../dist/server/server.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`;

if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be a valid TCP port");

const server = http.createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers();
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      const name = incoming.rawHeaders[index];
      const value = incoming.rawHeaders[index + 1];
      if (name && value) headers.append(name, value);
    }

    const method = incoming.method ?? "GET";
    const requestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(120_000),
    };
    if (method !== "GET" && method !== "HEAD") {
      requestInit.body = Readable.toWeb(incoming);
      requestInit.duplex = "half";
    }

    const request = new Request(
      new URL(incoming.url ?? "/", origin),
      requestInit,
    );
    const response = await application.fetch(request);
    for (const [name, value] of response.headers) {
      if (name.toLowerCase() !== "set-cookie") outgoing.setHeader(name, value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);
    outgoing.statusCode = response.status;

    if (!response.body) {
      outgoing.end();
      return;
    }
    Readable.fromWeb(response.body).pipe(outgoing);
  } catch (error) {
    console.error(error);
    if (!outgoing.headersSent) {
      outgoing.statusCode = 500;
      outgoing.setHeader("content-type", "application/json");
    }
    outgoing.end(JSON.stringify({ error: "internal_server_error" }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Upskill listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
