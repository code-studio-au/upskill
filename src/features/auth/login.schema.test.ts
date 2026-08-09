import { describe, expect, it } from "vitest";
import { loginCredentialsSchema, loginSearchSchema } from "./login.schema";

describe("login search", () => {
  it("accepts an internal redirect", () => {
    expect(loginSearchSchema.parse({ redirect: "/courses/example" })).toEqual({
      redirect: "/courses/example",
    });
  });

  it.each(["https://attacker.example", "//attacker.example", "dashboard"])(
    "replaces unsafe redirect %s",
    (redirect) => {
      expect(loginSearchSchema.parse({ redirect })).toEqual({
        redirect: "/dashboard",
      });
    },
  );

  it("validates login fields before authentication", () => {
    expect(
      loginCredentialsSchema.parse({
        email: "  learner@example.com ",
        password: "password",
      }),
    ).toEqual({ email: "learner@example.com", password: "password" });
    const invalid = loginCredentialsSchema.safeParse({
      email: "not-an-email",
      password: "",
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success)
      expect(invalid.error.issues.map((issue) => issue.message)).toEqual([
        "Enter a valid email address.",
        "Enter your password.",
      ]);
  });
});
