import { describe, expect, it } from "vitest";
import { loginSearchSchema } from "./login.schema";

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
});
