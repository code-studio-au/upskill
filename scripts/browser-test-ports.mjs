import net from "node:net";

export const browserTestHost = "127.0.0.1";
export const offlineScormPackageTestHost = "127.0.0.2";

export async function findAvailablePort(
  host,
  excludedPorts = new Set(),
  createServer = () => net.createServer(),
) {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host, port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a browser-test port"));
        return;
      }
      const port = String(address.port);
      server.close((error) => {
        if (error) reject(error);
        else if (excludedPorts.has(port))
          void findAvailablePort(host, excludedPorts, createServer).then(
            resolve,
            reject,
          );
        else resolve(port);
      });
    });
  });
}

export async function resolveBrowserTestPorts(input = {}) {
  const allocate = input.allocate ?? findAvailablePort;
  const browserPort =
    input.browserPort ?? (await allocate(browserTestHost, new Set()));
  const learningPort =
    input.learningPort ??
    (await allocate(browserTestHost, new Set([browserPort])));
  const offlineScormPackagePort =
    input.offlineScormPackagePort ??
    (await allocate(
      offlineScormPackageTestHost,
      new Set([browserPort, learningPort]),
    ));
  if (browserPort === learningPort)
    throw new Error(
      "Browser and learning test origins must use distinct ports",
    );
  if (
    offlineScormPackagePort === browserPort ||
    offlineScormPackagePort === learningPort
  )
    throw new Error(
      "Offline SCORM package test origin must use a distinct port",
    );
  return { browserPort, learningPort, offlineScormPackagePort };
}
