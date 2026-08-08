import fs from "node:fs";
import path from "node:path";

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
const jsBytes = js.reduce((total, file) => total + size(file), 0);
const cssBytes = css.reduce((total, file) => total + size(file), 0);
const largestJs = Math.max(0, ...js.map(size));
const failures = [];
if (jsBytes > budgets.clientJavaScriptBytes)
  failures.push(`Client JS ${jsBytes} > ${budgets.clientJavaScriptBytes}`);
if (cssBytes > budgets.clientCssBytes)
  failures.push(`Client CSS ${cssBytes} > ${budgets.clientCssBytes}`);
if (largestJs > budgets.largestJavaScriptAssetBytes)
  failures.push(
    `Largest JS asset ${largestJs} > ${budgets.largestJavaScriptAssetBytes}`,
  );
if (failures.length > 0) throw new Error(failures.join("\n"));
console.log(
  `Bundle verified: JS ${jsBytes} bytes, CSS ${cssBytes} bytes, largest JS ${largestJs} bytes`,
);
