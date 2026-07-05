export interface AnonymizeEngine {
  ip(real: string): string;
  mac(real: string): string;
  registerScrubEntry(real: string, fake: string): void;
  scrub(text: string): string;
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const SKIP_IPS = new Set(["127.0.0.1", "::1", "0.0.0.0", ""]);
const FAKE_V4_BASE_THIRD_OCTET = 200; // 10.200.0.0 .. 10.219.255.0 — 5,120 distinct /24s
const V6_FAKE_PREFIX = "2001:db8";

function isIPv4(s: string): boolean {
  return IPV4_RE.test(s);
}

function isIPv6(s: string): boolean {
  return s.includes(":") && !IPV4_RE.test(s);
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function macFormatLike(hexColonless6: string, real: string): string {
  const isColon = real.includes(":");
  const isDash = real.includes("-");
  if (!isColon && !isDash) {
    return real === real.toLowerCase() ? hexColonless6.toLowerCase() : hexColonless6.toUpperCase();
  }
  const sep = isDash ? "-" : ":";
  const pairs = hexColonless6.match(/.{2}/g)!.join(sep);
  return real === real.toLowerCase() ? pairs.toLowerCase() : pairs.toUpperCase();
}

export function createAnonymizer(): AnonymizeEngine {
  const ipMap = new Map<string, string>();
  const v4BucketFake = new Map<string, string>(); // real "a.b.c" -> fake "10.X.Y"
  const v4UsedHosts = new Map<string, Set<number>>(); // fake prefix -> used last-octet values
  const v6BucketFake = new Map<string, string>(); // real "a:b:c:d" -> fake "2001:db8:N"
  let v4BucketCount = 0;
  let v6BucketCount = 0;

  const macMap = new Map<string, string>(); // normalized (lowercase, no separators) real -> fake hex6

  const scrubEntries: [string, string][] = [];

  function nextFakeV4Prefix(): string {
    const n = v4BucketCount++;
    const third = FAKE_V4_BASE_THIRD_OCTET + Math.floor(n / 256);
    const second = n % 256;
    return `10.${third}.${second}`;
  }

  function ip(real: string): string {
    if (SKIP_IPS.has(real)) return real;
    const cached = ipMap.get(real);
    if (cached) return cached;

    let fake: string;
    if (isIPv4(real)) {
      const octets = real.split(".");
      const realBucket = octets.slice(0, 3).join(".");
      let fakePrefix = v4BucketFake.get(realBucket);
      if (!fakePrefix) {
        fakePrefix = nextFakeV4Prefix();
        v4BucketFake.set(realBucket, fakePrefix);
        v4UsedHosts.set(fakePrefix, new Set());
      }
      const used = v4UsedHosts.get(fakePrefix)!;
      let host = 2 + (fnv1a(real) % 250);
      while (used.has(host)) host = 2 + ((host + 1) % 250);
      used.add(host);
      fake = `${fakePrefix}.${host}`;
    } else if (isIPv6(real)) {
      const realBucket = real.split(":").slice(0, 4).join(":");
      let fakePrefix = v6BucketFake.get(realBucket);
      if (!fakePrefix) {
        fakePrefix = `${V6_FAKE_PREFIX}:${v6BucketCount++}`;
        v6BucketFake.set(realBucket, fakePrefix);
      }
      const h1 = fnv1a(real).toString(16).padStart(8, "0");
      const h2 = fnv1a(`${real}:salt`).toString(16).padStart(8, "0");
      fake = `${fakePrefix}::${h1.slice(0, 4)}:${h2.slice(0, 4)}`;
    } else {
      return real; // not IP-shaped — leave untouched
    }

    ipMap.set(real, fake);
    scrubEntries.push([real, fake]);
    return fake;
  }

  function mac(real: string): string {
    const key = real.toLowerCase().replace(/[:\-]/g, "");
    if (key.length !== 12) return real; // not MAC-shaped — leave untouched
    let hex6 = macMap.get(key);
    if (!hex6) {
      const h1 = fnv1a(key);
      const h2 = fnv1a(`${key}:salt`);
      const bytes = [
        0x02, // locally administered, unicast
        (h1 >>> 24) & 0xff,
        (h1 >>> 16) & 0xff,
        (h1 >>> 8) & 0xff,
        h1 & 0xff,
        h2 & 0xff,
      ];
      hex6 = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
      macMap.set(key, hex6);
    }
    const fake = macFormatLike(hex6, real);
    scrubEntries.push([real, fake]);
    return fake;
  }

  function registerScrubEntry(real: string, fake: string): void {
    if (!real || real === fake) return;
    scrubEntries.push([real, fake]);
  }

  function scrub(text: string): string {
    if (!text) return text;
    let out = text;
    const sorted = [...scrubEntries].sort((a, b) => b[0].length - a[0].length);
    for (const [real, fake] of sorted) {
      if (!real || !out.includes(real)) continue;
      out = out.split(real).join(fake);
    }
    return out;
  }

  return { ip, mac, registerScrubEntry, scrub };
}
