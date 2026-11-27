import { describe, expect, it } from "vitest";
import {
  assertSafePublicUrl,
  createWebToolDefinitions,
  isBlockedIpAddress,
  webToolsPackage
} from "./index.js";

describe("builtin.web-tools SSRF protection, web.search, and untrusted_external taint", () => {
  it("blocks loopback, RFC1918 private, link-local/cloud-metadata, and IPv6 private/mapped addresses", async () => {
    expect(isBlockedIpAddress("127.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("10.0.0.5")).toBe(true);
    expect(isBlockedIpAddress("172.16.10.2")).toBe(true);
    expect(isBlockedIpAddress("192.168.1.1")).toBe(true);
    expect(isBlockedIpAddress("169.254.169.254")).toBe(true);
    expect(isBlockedIpAddress("::1")).toBe(true);
    expect(isBlockedIpAddress("fe80::1")).toBe(true);
    expect(isBlockedIpAddress("fd00::1234")).toBe(true);
    expect(isBlockedIpAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("::ffff:169.254.169.254")).toBe(true);

    expect(isBlockedIpAddress("93.184.216.34")).toBe(false);
    expect(isBlockedIpAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);

    await expect(
      assertSafePublicUrl("http://localhost:4174/api/studio/bootstrap")
    ).rejects.toThrow(/Blocked/u);
    await expect(
      assertSafePublicUrl("https://evil.example.com/secret", async () => [{ address: "169.254.169.254", family: 4 }])
    ).rejects.toThrow(/169\.254\.169\.254/u);
  });

  it("executes web.search (DuckDuckGo HTML & SearXNG SSRF guard) and web.fetch_url with untrusted_external taint", async () => {
    expect(webToolsPackage.manifest.default_enabled).toBe(false);
    const tools = createWebToolDefinitions({
      lookupFn: async (host) =>
        host === "public.example.com" || host === "html.duckduckgo.com"
          ? [{ address: "93.184.216.34", family: 4 }]
          : [{ address: "10.0.0.8", family: 4 }],
      fetchFn: async (input) => {
        const url = String(input);
        if (url.startsWith("https://html.duckduckgo.com/html/")) {
          return new Response(
            `<div>
              <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fpublic.example.com%2Fdocs">Example Docs</a>
              <a class="result__snippet">Official universal agent documentation.</a>
            </div>`,
            { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
        if (url === "https://public.example.com/redirect-internal") {
          return new Response(null, {
            status: 302,
            headers: { Location: "http://internal.corp.example/admin" }
          });
        }
        return new Response(
          "<html><head><style>.x{}</style><script>evil()</script></head><body><h1>Docs</h1><p>Hello world</p></body></html>",
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
    });

    const searchTool = tools.find((t) => t.name === "web.search")!;
    const fetchTool = tools.find((t) => t.name === "web.fetch_url")!;
    expect(searchTool.resultTaint).toBe("untrusted_external");
    expect(fetchTool.resultTaint).toBe("untrusted_external");

    const searchRes = await searchTool.execute(
      { kind: "tool", id: "s1", name: "web.search", input: { query: "universal agent" } },
      new AbortController().signal
    );
    expect(searchRes).toEqual({
      status: "verified",
      value: {
        query: "universal agent",
        provider: "duckduckgo_html",
        results: [
          {
            title: "Example Docs",
            url: "https://public.example.com/docs",
            snippet: "Official universal agent documentation."
          }
        ]
      }
    });

    // Verify SSRF block on custom searxng endpoint pointing to internal IP
    const [searxTool] = createWebToolDefinitions({
      search_provider: "searxng",
      search_endpoint_url: "http://internal.corp.example:8080/search",
      lookupFn: async () => [{ address: "192.168.1.50", family: 4 }]
    });
    const blockedSearx = await searxTool!.execute(
      { kind: "tool", id: "s2", name: "web.search", input: { query: "test" } },
      new AbortController().signal
    );
    expect(blockedSearx).toMatchObject({ status: "failed", error: expect.stringMatching(/192\.168\.1\.50/u) });

    const blockedRedirect = await fetchTool.execute(
      { kind: "tool", id: "c1", name: "web.fetch_url", input: { url: "https://public.example.com/redirect-internal" } },
      new AbortController().signal
    );
    expect(blockedRedirect).toMatchObject({ status: "failed", error: expect.stringMatching(/10\.0\.0\.8/u) });

    const okResult = await fetchTool.execute(
      { kind: "tool", id: "c2", name: "web.fetch_url", input: { url: "https://public.example.com/docs" } },
      new AbortController().signal
    );
    expect(okResult).toEqual({
      status: "verified",
      value: {
        finalUrl: "https://public.example.com/docs",
        status: 200,
        contentType: "text/html; charset=utf-8",
        truncated: false,
        content: "Docs\nHello world"
      }
    });
  });
});
