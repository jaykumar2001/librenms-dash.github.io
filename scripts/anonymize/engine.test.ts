import { describe, it, expect } from "vitest";
import { createAnonymizer } from "./engine";

describe("ip()", () => {
  it("returns a different value than the input", () => {
    const eng = createAnonymizer();
    expect(eng.ip("10.5.26.1")).not.toBe("10.5.26.1");
  });

  it("is stable for the same input", () => {
    const eng = createAnonymizer();
    const a = eng.ip("10.5.26.1");
    const b = eng.ip("10.5.26.1");
    expect(a).toBe(b);
  });

  it("preserves /24 grouping for IPv4", () => {
    const eng = createAnonymizer();
    const a = eng.ip("192.168.0.101");
    const b = eng.ip("192.168.0.105");
    const c = eng.ip("192.168.1.50");
    const bucket = (ip: string) => ip.split(".").slice(0, 3).join(".");
    expect(bucket(a)).toBe(bucket(b));
    expect(bucket(a)).not.toBe(bucket(c));
  });

  it("preserves prefix grouping for IPv6", () => {
    const eng = createAnonymizer();
    const a = eng.ip("2406:7400:121:396:4af1:7fff:fe43:c358");
    const b = eng.ip("2406:7400:121:396:8446:a2ff:febc:d35e");
    const c = eng.ip("fd42:2e96:a0ef:cb72::1");
    const bucket = (ip: string) => ip.split(":").slice(0, 4).join(":");
    expect(bucket(a)).toBe(bucket(b));
    expect(bucket(a)).not.toBe(bucket(c));
  });

  it("leaves loopback addresses untouched", () => {
    const eng = createAnonymizer();
    expect(eng.ip("127.0.0.1")).toBe("127.0.0.1");
    expect(eng.ip("::1")).toBe("::1");
  });
});

describe("mac()", () => {
  it("returns a locally-administered, unicast address", () => {
    const eng = createAnonymizer();
    const fake = eng.mac("8C1645FA1500");
    const firstByte = parseInt(fake.slice(0, 2), 16);
    expect(firstByte & 0x02).toBe(0x02); // locally administered bit set
    expect(firstByte & 0x01).toBe(0); // unicast bit clear
  });

  it("preserves colonless-uppercase format", () => {
    const eng = createAnonymizer();
    const fake = eng.mac("8C1645FA1500");
    expect(fake).toMatch(/^[0-9A-F]{12}$/);
  });

  it("preserves colon-lowercase format", () => {
    const eng = createAnonymizer();
    const fake = eng.mac("8c:16:45:fa:15:00");
    expect(fake).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
  });

  it("maps the same real MAC to the same fake bytes regardless of format", () => {
    const eng = createAnonymizer();
    const colonless = eng.mac("8C1645FA1500");
    const colon = eng.mac("8c:16:45:fa:15:00");
    expect(colon.replace(/:/g, "").toLowerCase()).toBe(colonless.toLowerCase());
  });
});

describe("scrub()", () => {
  it("replaces every registered real value with its fake counterpart", () => {
    const eng = createAnonymizer();
    const fakeIp = eng.ip("10.5.26.1");
    eng.registerScrubEntry("blr01", "core-sw-01.demo.lan");
    const text = "Interface uplink to blr01 (10.5.26.1) is up";
    const scrubbed = eng.scrub(text);
    expect(scrubbed).not.toContain("blr01");
    expect(scrubbed).not.toContain("10.5.26.1");
    expect(scrubbed).toContain("core-sw-01.demo.lan");
    expect(scrubbed).toContain(fakeIp);
  });

  it("prefers the longest match so substrings don't clobber each other", () => {
    const eng = createAnonymizer();
    eng.registerScrubEntry("blr", "hq");
    eng.registerScrubEntry("blr01", "core-sw-01.demo.lan");
    expect(eng.scrub("blr01")).toBe("core-sw-01.demo.lan");
  });
});
