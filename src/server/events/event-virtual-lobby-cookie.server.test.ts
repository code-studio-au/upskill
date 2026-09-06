import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  environment: { APP_ENV: "test" },
}));

vi.mock("#/server/env.server", () => ({
  getServerEnv: () => mocks.environment,
}));

describe("event virtual lobby capability cookies", () => {
  beforeEach(() => {
    mocks.environment.APP_ENV = "test";
  });

  it("keeps concurrent webinar capabilities in independent exact-path cookies", async () => {
    const {
      eventVirtualChallengeCookie,
      eventVirtualJoinSessionCookie,
      readEventVirtualChallengeCookie,
      readEventVirtualJoinSessionCookie,
    } = await import("./event-virtual-lobby.server");
    const firstReference = "a".repeat(43);
    const secondReference = "b".repeat(43);
    const firstToken = "c".repeat(43);
    const secondToken = "d".repeat(43);
    const firstJoinCookie = eventVirtualJoinSessionCookie(
      firstToken,
      firstReference,
    );
    const secondJoinCookie = eventVirtualJoinSessionCookie(
      secondToken,
      secondReference,
    );

    expect(firstJoinCookie.split("=", 1)[0]).not.toBe(
      secondJoinCookie.split("=", 1)[0],
    );
    expect(firstJoinCookie).toContain(`Path=/webinars/${firstReference}`);
    expect(secondJoinCookie).toContain(`Path=/webinars/${secondReference}`);
    const joinHeaders = new Headers({
      cookie: `upskill_virtual_join_${firstReference}=${firstToken}; upskill_virtual_join_${secondReference}=${secondToken}`,
    });
    expect(readEventVirtualJoinSessionCookie(joinHeaders, firstReference)).toBe(
      firstToken,
    );
    expect(
      readEventVirtualJoinSessionCookie(joinHeaders, secondReference),
    ).toBe(secondToken);

    const firstChallenge = "e".repeat(32);
    const secondChallenge = "f".repeat(32);
    const firstChallengeCookie = eventVirtualChallengeCookie(
      firstChallenge,
      firstReference,
    );
    const secondChallengeCookie = eventVirtualChallengeCookie(
      secondChallenge,
      secondReference,
    );
    expect(firstChallengeCookie.split("=", 1)[0]).not.toBe(
      secondChallengeCookie.split("=", 1)[0],
    );
    const challengeRequest = new Request("https://example.com/", {
      headers: {
        cookie: `upskill_virtual_challenge_${firstReference}=${firstChallenge}; upskill_virtual_challenge_${secondReference}=${secondChallenge}`,
      },
    });
    expect(
      readEventVirtualChallengeCookie(challengeRequest, firstReference),
    ).toBe(firstChallenge);
    expect(
      readEventVirtualChallengeCookie(challengeRequest, secondReference),
    ).toBe(secondChallenge);
  });

  it("uses secure prefixes while retaining the exact webinar path", async () => {
    mocks.environment.APP_ENV = "staging";
    const { clearEventVirtualChallengeCookie, eventVirtualJoinSessionCookie } =
      await import("./event-virtual-lobby.server");
    const publicReference = "g".repeat(43);

    expect(eventVirtualJoinSessionCookie("h".repeat(43), publicReference)).toBe(
      `__Secure-upskill_virtual_join_${publicReference}=${"h".repeat(43)}; Path=/webinars/${publicReference}; HttpOnly; SameSite=Lax; Max-Age=1800; Secure`,
    );
    expect(clearEventVirtualChallengeCookie(publicReference)).toBe(
      `__Secure-upskill_virtual_challenge_${publicReference}=; Path=/webinars/${publicReference}; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    );
  });
});
