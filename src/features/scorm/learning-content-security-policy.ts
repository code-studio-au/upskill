export function buildLearningContentSecurityPolicy(
  applicationOrigin: string,
  options: { connectSources?: ReadonlyArray<string> } = {},
): string {
  const directives = {
    "base-uri": ["'none'"],
    "connect-src": ["'self'", ...(options.connectSources ?? [])],
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
