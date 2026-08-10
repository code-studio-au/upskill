import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const tlsDirectory = path.resolve(".local/tls");
const paths = {
  caCertificate: path.join(tlsDirectory, "upskill-local-ca.crt"),
  caKey: path.join(tlsDirectory, "upskill-local-ca.key"),
  certificate: path.join(tlsDirectory, "localhost.crt"),
  certificateRequest: path.join(tlsDirectory, "localhost.csr"),
  extensions: path.join(tlsDirectory, "localhost.ext"),
  key: path.join(tlsDirectory, "localhost.key"),
  serial: path.join(tlsDirectory, "upskill-local-ca.srl"),
};

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function openssl(arguments_) {
  const result = spawnSync("openssl", arguments_, {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    throw new Error(
      `openssl exited with ${String(result.status)}${detail ? `: ${detail}` : ""}`,
    );
  }
}

async function removeIfPresent(target) {
  try {
    await unlink(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function ensureLocalTls() {
  await mkdir(tlsDirectory, { recursive: true, mode: 0o700 });
  const hasCa =
    (await exists(paths.caCertificate)) && (await exists(paths.caKey));
  if (!hasCa) {
    openssl(["genrsa", "-out", paths.caKey, "2048"]);
    openssl([
      "req",
      "-x509",
      "-new",
      "-key",
      paths.caKey,
      "-sha256",
      "-days",
      "3650",
      "-subj",
      "/CN=Upskill Local Development CA",
      "-out",
      paths.caCertificate,
    ]);
  }

  const hasServerCertificate =
    hasCa && (await exists(paths.certificate)) && (await exists(paths.key));
  if (!hasServerCertificate) {
    await writeFile(
      paths.extensions,
      [
        "authorityKeyIdentifier=keyid,issuer",
        "basicConstraints=CA:FALSE",
        "keyUsage=digitalSignature,keyEncipherment",
        "extendedKeyUsage=serverAuth",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ].join("\n"),
      { mode: 0o600 },
    );
    openssl(["genrsa", "-out", paths.key, "2048"]);
    openssl([
      "req",
      "-new",
      "-key",
      paths.key,
      "-subj",
      "/CN=localhost",
      "-out",
      paths.certificateRequest,
    ]);
    openssl([
      "x509",
      "-req",
      "-in",
      paths.certificateRequest,
      "-CA",
      paths.caCertificate,
      "-CAkey",
      paths.caKey,
      "-CAserial",
      paths.serial,
      "-CAcreateserial",
      "-out",
      paths.certificate,
      "-days",
      "825",
      "-sha256",
      "-extfile",
      paths.extensions,
    ]);
    await removeIfPresent(paths.certificateRequest);
    await removeIfPresent(paths.extensions);
    await removeIfPresent(paths.serial);
  }

  await chmod(paths.caKey, 0o600);
  await chmod(paths.key, 0o600);
  await chmod(paths.caCertificate, 0o644);
  await chmod(paths.certificate, 0o644);
  return {
    caCertificate: paths.caCertificate,
    certificate: paths.certificate,
    key: paths.key,
  };
}
