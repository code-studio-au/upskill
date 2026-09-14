import { describe, expect, it } from "vitest";
import { qualifyingConnectedMilliseconds } from "./event-virtual-attendance.server";

const at = (minute: number) => new Date(Date.UTC(2030, 0, 1, 10, minute));

describe("qualifyingConnectedMilliseconds", () => {
  it("unions overlapping connections and clamps them to the attendance window", () => {
    expect(
      qualifyingConnectedMilliseconds(
        [
          { joinedAt: at(-5), leftAt: at(10) },
          { joinedAt: at(5), leftAt: at(20) },
          { joinedAt: at(25), leftAt: null },
        ],
        at(0),
        at(30),
      ),
    ).toBe(25 * 60_000);
  });

  it("ignores intervals wholly outside the window and empty windows", () => {
    expect(
      qualifyingConnectedMilliseconds(
        [
          { joinedAt: at(-10), leftAt: at(-5) },
          { joinedAt: at(35), leftAt: at(40) },
        ],
        at(0),
        at(30),
      ),
    ).toBe(0);
    expect(qualifyingConnectedMilliseconds([], at(30), at(30))).toBe(0);
  });

  it("caps open intervals at the terminal time of their own room generation", () => {
    expect(
      qualifyingConnectedMilliseconds(
        [
          {
            joinedAt: at(0),
            leftAt: null,
            roomEndedAt: at(6),
            roomReplacedAt: at(5),
          },
          { joinedAt: at(20), leftAt: at(30) },
        ],
        at(0),
        at(40),
      ),
    ).toBe(15 * 60_000);
  });

  it("does not qualify a connection wholly after its room terminated", () => {
    expect(
      qualifyingConnectedMilliseconds(
        [
          {
            joinedAt: at(35),
            leftAt: null,
            roomEndedAt: at(30),
            roomReplacedAt: null,
          },
        ],
        at(0),
        at(40),
      ),
    ).toBe(0);
  });
});
