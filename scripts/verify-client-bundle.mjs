import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const publicDirectory = path.join(root, "dist/client");
const budgets = JSON.parse(
  fs.readFileSync(path.join(root, "config/bundle-budgets.json"), "utf8"),
);

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}

if (!fs.existsSync(publicDirectory))
  throw new Error("Build output dist/client is missing");
const assets = files(publicDirectory);
const js = assets.filter((file) => /\.(?:js|mjs)$/.test(file));
const css = assets.filter((file) => file.endsWith(".css"));
const size = (file) => fs.statSync(file).size;
const gzipSize = (file) => gzipSync(fs.readFileSync(file)).byteLength;
const assetPath = (asset) =>
  path.join(publicDirectory, asset.replace(/^\//, ""));
const sumUniqueAssets = (assetUrls, measure) =>
  [...new Set(assetUrls)].reduce((total, asset) => {
    const file = assetPath(asset);
    if (!fs.existsSync(file))
      throw new Error(`Manifest asset missing: ${asset}`);
    return total + measure(file);
  }, 0);
const jsBytes = js.reduce((total, file) => total + size(file), 0);
const cssBytes = css.reduce((total, file) => total + size(file), 0);
const largestJs = Math.max(0, ...js.map(size));

const manifestFiles = files(path.join(root, "dist/server/assets")).filter(
  (file) => path.basename(file).startsWith("_tanstack-start-manifest_v-"),
);
if (manifestFiles.length !== 1)
  throw new Error(
    `Expected one TanStack Start manifest, found ${String(manifestFiles.length)}`,
  );
const manifestModule = await import(pathToFileURL(manifestFiles[0]).href);
const routes = manifestModule.tsrStartManifest().routes;
const rootRoute = routes.__root__;
if (!rootRoute) throw new Error("TanStack Start manifest has no root route");

const rootPreloads = rootRoute.preloads ?? [];
const rootCss = rootRoute.css ?? [];
const rootPreloadJavaScriptGzipBytes = sumUniqueAssets(rootPreloads, gzipSize);
const rootCssGzipBytes = sumUniqueAssets(rootCss, gzipSize);
const rootPreloadSet = new Set(rootPreloads);
const rootCssSet = new Set(rootCss);
let largestRouteJavaScript = { route: "", bytes: 0 };
let largestRouteCss = { route: "", bytes: 0 };
const failures = [];

for (const [route, entry] of Object.entries(routes)) {
  if (route === "__root__") continue;
  const isUserInterfaceRoute =
    entry.filePath?.endsWith(".tsx") && !route.startsWith("/api/");
  if (isUserInterfaceRoute && (entry.preloads?.length ?? 0) === 0)
    failures.push(`UI route has no lazy preload chunk: ${route}`);
  const routeJavaScript = (entry.preloads ?? []).filter(
    (asset) => !rootPreloadSet.has(asset),
  );
  const routeCss = (entry.css ?? []).filter((asset) => !rootCssSet.has(asset));
  const routeJavaScriptBytes = sumUniqueAssets(routeJavaScript, gzipSize);
  const routeCssBytes = sumUniqueAssets(routeCss, gzipSize);
  if (routeJavaScriptBytes > largestRouteJavaScript.bytes)
    largestRouteJavaScript = { route, bytes: routeJavaScriptBytes };
  if (routeCssBytes > largestRouteCss.bytes)
    largestRouteCss = { route, bytes: routeCssBytes };
}

if (jsBytes > budgets.clientJavaScriptBytes)
  failures.push(`Client JS ${jsBytes} > ${budgets.clientJavaScriptBytes}`);
if (cssBytes > budgets.clientCssBytes)
  failures.push(`Client CSS ${cssBytes} > ${budgets.clientCssBytes}`);
if (largestJs > budgets.largestJavaScriptAssetBytes)
  failures.push(
    `Largest JS asset ${largestJs} > ${budgets.largestJavaScriptAssetBytes}`,
  );
if (rootPreloadJavaScriptGzipBytes > budgets.rootPreloadJavaScriptGzipBytes)
  failures.push(
    `Root preload JS gzip ${rootPreloadJavaScriptGzipBytes} > ${budgets.rootPreloadJavaScriptGzipBytes}`,
  );
if (rootCssGzipBytes > budgets.rootCssGzipBytes)
  failures.push(
    `Root CSS gzip ${rootCssGzipBytes} > ${budgets.rootCssGzipBytes}`,
  );
if (largestRouteJavaScript.bytes > budgets.routeIncrementalJavaScriptGzipBytes)
  failures.push(
    `Route ${largestRouteJavaScript.route} incremental JS gzip ${largestRouteJavaScript.bytes} > ${budgets.routeIncrementalJavaScriptGzipBytes}`,
  );
if (largestRouteCss.bytes > budgets.routeIncrementalCssGzipBytes)
  failures.push(
    `Route ${largestRouteCss.route} incremental CSS gzip ${largestRouteCss.bytes} > ${budgets.routeIncrementalCssGzipBytes}`,
  );
if (failures.length > 0) throw new Error(failures.join("\n"));
console.log(
  [
    `Bundle verified: total JS ${jsBytes} bytes, total CSS ${cssBytes} bytes, largest JS ${largestJs} bytes`,
    `root gzip JS ${rootPreloadJavaScriptGzipBytes} bytes, root gzip CSS ${rootCssGzipBytes} bytes`,
    `largest route gzip JS ${largestRouteJavaScript.bytes} bytes (${largestRouteJavaScript.route}), CSS ${largestRouteCss.bytes} bytes (${largestRouteCss.route})`,
  ].join("; "),
);
