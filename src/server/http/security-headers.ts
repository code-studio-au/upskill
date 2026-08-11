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

export function buildLearningContentSecurityPolicy(
  applicationOrigin: string,
): string {
  const directives = {
    "base-uri": ["'none'"],
    "connect-src": ["'self'"],
    "default-src": ["'self'"],
    "font-src": ["'self'", "data:"],
    "form-action": ["'none'"],
    "frame-ancestors": ["'self'", applicationOrigin],
    // Rise 360 proxies supported third-party media, including Vimeo, through
    // Articulate's embed boundary rather than framing the provider directly.
    "frame-src": ["'self'", "https://embed.articulateusercontent.com"],
    "img-src": ["'self'", "data:", "blob:"],
    "media-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    "script-src-attr": ["'unsafe-inline'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "style-src-attr": ["'unsafe-inline'"],
    "worker-src": ["'self'", "blob:"],
  } as const;
  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

export function applySecurityHeaders(
  headers: Headers,
  nonce: string,
  request?: Request,
): void {
  const learningOrigin = process.env.LEARNING_ORIGIN ?? "http://localhost:3001";
  const applicationOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  const normalizedLearningOrigin = new URL(learningOrigin).origin;
  const normalizedApplicationOrigin = new URL(applicationOrigin).origin;
  const requestUrl = request ? new URL(request.url) : null;
  const isLearningResponse =
    requestUrl?.origin === normalizedLearningOrigin &&
    requestUrl.pathname.startsWith("/api/scorm/");
  headers.set(
    "Content-Security-Policy",
    isLearningResponse
      ? buildLearningContentSecurityPolicy(normalizedApplicationOrigin)
      : buildContentSecurityPolicy(nonce, normalizedLearningOrigin),
  );
  if (isLearningResponse) headers.delete("Cross-Origin-Opener-Policy");
  else headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set(
    "Permissions-Policy",
    isLearningResponse
      ? "camera=(), geolocation=(), microphone=(), payment=()"
      : "camera=(), geolocation=(), microphone=(), payment=(self)",
  );
  headers.set(
    "Referrer-Policy",
    isLearningResponse ? "no-referrer" : "strict-origin-when-cross-origin",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  if (isLearningResponse) headers.delete("X-Frame-Options");
  else headers.set("X-Frame-Options", "DENY");

  if (
    process.env.APP_ENV === "production" ||
    process.env.APP_ENV === "staging"
  ) {
    headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
}
