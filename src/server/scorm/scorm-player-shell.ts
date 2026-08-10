import type { AuthorizedScormPlayer } from "#/server/scorm/scorm-attempt.server";

function escapeHtml(value: string): string {
  return value.replaceAll(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

export function buildScormPlayerShell(player: AuthorizedScormPlayer): string {
  const attemptId = escapeHtml(player.state.attemptId);
  return `<!doctype html>
<html lang="en" data-attempt-id="${attemptId}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Course module</title>
    <link rel="stylesheet" href="/api/scorm/attempts/${attemptId}?runtime=style">
    <script src="/api/scorm/attempts/${attemptId}?runtime=script" defer></script>
  </head>
  <body>
    <main>
      <div id="scorm-status" role="status">Preparing module…</div>
      <iframe id="scorm-content" title="Course module"></iframe>
    </main>
  </body>
</html>`;
}

export const SCORM_RUNTIME_STYLES = `
html, body, main { width: 100%; min-height: 100%; margin: 0; }
body { background: #f8f9fa; color: #1f2937; font: 600 1rem/1.5 system-ui, sans-serif; }
main { display: grid; min-height: 100vh; }
#scorm-status { align-self: center; justify-self: center; padding: 1rem; text-align: center; }
#scorm-content { display: none; width: 100%; min-height: 100vh; border: 0; background: white; }
#scorm-content[data-ready="true"] { display: block; }
`;
