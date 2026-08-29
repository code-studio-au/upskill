import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

describe("static CSS button", () => {
  it("defaults to a non-submitting button without inline styles", () => {
    const html = renderToStaticMarkup(<Button>Continue</Button>);
    expect(html).toContain('type="button"');
    expect(html).not.toContain("style=");
  });

  it("preserves submit and loading semantics", () => {
    const html = renderToStaticMarkup(
      <Button type="submit" loading>
        Save
      </Button>,
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
  });

  it("supports polymorphic links and marks unavailable links accessibly", () => {
    const html = renderToStaticMarkup(
      <Button component="a" href="/dashboard" disabled>
        Dashboard
      </Button>,
    );
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('aria-disabled="true"');
  });
});
