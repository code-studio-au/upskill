import { ensureLocalTls } from "./local-tls.mjs";

const tls = await ensureLocalTls();
console.log(`Local TLS certificate: ${tls.certificate}`);
console.log(`Local development CA: ${tls.caCertificate}`);
