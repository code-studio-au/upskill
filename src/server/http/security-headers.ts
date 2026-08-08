const DIRECTIVES = {
  "base-uri": ["'none'"],
  "connect-src": ["'self'"],
  "default-src": ["'self'"],
  "font-src": ["'self'", "data:"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "img-src": ["'self'", "data:", "blob:"],
  "manifest-src": ["'self'"],
  "media-src": ["'self'", "blob:"],
  "object-src": ["'none'"],
  "script-src-attr": ["'none'"],
  "worker-src": ["'self'", "blob:"],
} as const;

export function buildContentSecurityPolicy(
  nonce: string,
  learningOrigin: string,
): string {
  const dynamic = {
    ...DIRECTIVES,
    "frame-src": [learningOrigin],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"],
    "style-src": ["'self'", `'nonce-${nonce}'`],
    "style-src-elem": ["'self'", `'nonce-${nonce}'`],
    // Mantine uses style attributes for CSS variables and runtime geometry.
    "style-src-attr": ["'unsafe-inline'"],
  };

  return Object.entries(dynamic)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

export function applySecurityHeaders(headers: Headers, nonce: string): void {
  const learningOrigin = process.env.LEARNING_ORIGIN ?? "http://localhost:3001";
  headers.set(
    "Content-Security-Policy",
    buildContentSecurityPolicy(nonce, learningOrigin),
  );
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(self)",
  );
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");

  if (process.env.NODE_ENV === "production") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
}
