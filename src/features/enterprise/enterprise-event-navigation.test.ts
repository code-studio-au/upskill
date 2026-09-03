import { describe, expect, it } from "vitest";
import { alreadyRegisteredEventDestination } from "./enterprise-event-navigation";

describe("alreadyRegisteredEventDestination", () => {
  it("opens the questionnaire or confirmed event workspace", () => {
    expect(
      alreadyRegisteredEventDestination({
        registrationRequired: true,
        canOpenEvent: false,
      }),
    ).toBe("event");
    expect(
      alreadyRegisteredEventDestination({
        registrationRequired: false,
        canOpenEvent: true,
      }),
    ).toBe("event");
  });

  it("routes a completed non-selected registration through My Events", () => {
    expect(
      alreadyRegisteredEventDestination({
        registrationRequired: false,
        canOpenEvent: false,
      }),
    ).toBe("my-events");
  });
});
