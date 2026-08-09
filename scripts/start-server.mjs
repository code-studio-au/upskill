import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import application from "../dist/server/server.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`;
const clientDirectory = path.resolve(
  fileURLToPath(new URL("../dist/client/", import.meta.url)),
);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be a valid TCP port");

async function serveClientAsset(incoming, outgoing) {
  const method = incoming.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return false;

  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(incoming.url ?? "/", origin).pathname,
    );
  } catch {
    return false;
  }
  if (!pathname.startsWith("/assets/")) return false;

  const target = path.resolve(clientDirectory, `.${pathname}`);
  if (!target.startsWith(`${clientDirectory}${path.sep}`)) return false;

  let details;
  try {
    details = await stat(target);
  } catch {
    return false;
  }
  if (!details.isFile()) return false;

  outgoing.statusCode = 200;
  outgoing.setHeader("cache-control", "public, max-age=31536000, immutable");
  outgoing.setHeader("content-length", details.size);
  outgoing.setHeader(
    "content-type",
    contentTypes.get(path.extname(target)) ?? "application/octet-stream",
  );
  outgoing.setHeader("x-content-type-options", "nosniff");
  if (method === "HEAD") {
    outgoing.end();
  } else {
    createReadStream(target).pipe(outgoing);
  }
  return true;
}

const server = http.createServer(async (incoming, outgoing) => {
  try {
    if (await serveClientAsset(incoming, outgoing)) return;

    const headers = new Headers();
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      const name = incoming.rawHeaders[index];
      const value = incoming.rawHeaders[index + 1];
      if (name && value) headers.append(name, value);
    }
    const remoteAddress = incoming.socket.remoteAddress;
    if (remoteAddress) headers.set("x-real-ip", remoteAddress);

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
