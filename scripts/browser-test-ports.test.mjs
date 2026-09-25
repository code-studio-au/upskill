import { describe, expect, it, vi } from "vitest";
import {
  findAvailablePort,
  resolveBrowserTestPorts,
} from "./browser-test-ports.mjs";

describe("browser test port allocation", () => {
  it("binds the allocator probe to the requested host", async () => {
    const listen = vi.fn((_options, ready) => ready());
    const server = {
      address: () => ({ address: "127.0.0.2", family: "IPv4", port: 43102 }),
      close: (callback) => callback(),
      listen,
      once: vi.fn(),
      unref: vi.fn(),
    };

    await expect(
      findAvailablePort("127.0.0.2", new Set(), () => server),
    ).resolves.toBe("43102");
    expect(listen).toHaveBeenCalledWith(
      { host: "127.0.0.2", port: 0 },
      expect.any(Function),
    );
  });

  it("allocates the package port on its distinct loopback host", async () => {
    const ports = ["43100", "43101", "43102"];
    const allocate = vi.fn(() => Promise.resolve(ports.shift()));

    await expect(resolveBrowserTestPorts({ allocate })).resolves.toEqual({
      browserPort: "43100",
      learningPort: "43101",
      offlineScormPackagePort: "43102",
    });
    expect(allocate.mock.calls).toEqual([
      ["127.0.0.1", new Set()],
      ["127.0.0.1", new Set(["43100"])],
      ["127.0.0.2", new Set(["43100", "43101"])],
    ]);
  });
});
