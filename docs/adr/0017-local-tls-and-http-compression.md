# ADR 0017: Local TLS and HTTP compression

Status: Accepted

## Decision

Production builds create deterministic Brotli quality-11 and gzip level-9
sidecars for compressible client assets. A sidecar is retained only when it is
smaller than its source. Bundle verification decompresses JavaScript and CSS
sidecars, compares them byte-for-byte with their sources and enforces total
Brotli wire budgets alongside the existing raw and gzip architectural budgets.
Source maps are neither precompressed nor included in runtime build output.

The repository provides a production-build local preview on two HTTPS origins.
OpenSSL creates a persistent ignored development CA and a localhost certificate
with localhost and loopback subject alternatives under `.local/tls`. The CA is
never committed and trust remains an explicit developer-machine action.

The local HTTPS server negotiates a verified static representation in this
order: Brotli, gzip, identity. Brotli is selected only on TLS. Dynamic HTML and
textual API responses use gzip level 6 with synchronous flush boundaries so
TanStack Start streaming remains incremental. Responses already encoded,
smaller than the known threshold, ranged, non-transformable or naturally
compressed are not recompressed. Every negotiated representation includes
`Vary: Accept-Encoding`.

The Node listener remains loopback-only and does not trust a client-supplied
`X-Real-IP` by default. Nginx deployments explicitly enable trusted-proxy mode;
Nginx overwrites that header before forwarding, preserving per-client auth rate
limits without exposing a spoofable public boundary. Playwright enables the
same mode while assigning reserved test addresses to its browser projects.

The standard Nginx gzip module provides the deployment fallback for proxied
HTML and compressible static responses. Upskill does not compile or install a
third-party Brotli Nginx module during EC2 boot. Production Brotli activation
therefore requires a separately verified packaged module or edge/CDN delivery;
the build artifact already contains the integrity-checked sidecars.

## Consequences

Local browser smoke exercises HTTPS, Brotli assets, gzip fallback and streaming
gzip SSR using the same built artifact shape promoted by CI. Modern clients
download the measured smaller static representation without sacrificing gzip
compatibility. PDFs, archives, images and compressed fonts remain unmodified.
The locally generated CA must be trusted once for warning-free manual browser
use, and production Brotli remains disabled until its serving component is an
explicitly verified dependency.

Local Vite development continues to provide source-level errors. Production
stack traces remain minified until a Datadog pipeline generates private source
maps, uploads them with the matching deployment/release identifier and removes
them before release packaging. That upload is required for Datadog to resolve
production errors to exact TypeScript files and line numbers.
