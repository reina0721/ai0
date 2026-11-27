import { z } from "zod";
import type { AgentToolDefinition, AgentValueSchema, Ai0ExtensionManifest } from "@ai0/protocol";
import { agentToolProviderFacet, consoleConfigSchemaFacet, defineExtensionPackage } from "@ai0/sdk";
import rawManifest from "../ai0.extension.json" with { type: "json" };
import {
  assertSafePublicUrl,
  isBlockedIpAddress,
  WebSsrfBlockedError,
  type DnsLookupFn
} from "./ssrf-guard.js";

export { assertSafePublicUrl, isBlockedIpAddress, WebSsrfBlockedError, type DnsLookupFn };

export type WebSearchProviderId = "duckduckgo_html" | "searxng" | "tavily" | "brave";

export interface WebSearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface WebToolsConfig {
  readonly search_provider?: WebSearchProviderId;
  readonly search_endpoint_url?: string;
  readonly search_api_key?: string;
  readonly allow_local_searxng?: boolean;
  readonly max_response_bytes?: number;
  readonly request_timeout_ms?: number;
  readonly lookupFn?: DnsLookupFn;
  readonly fetchFn?: typeof fetch;
}

function zodValueSchema<T>(schema: z.ZodType<T>, jsonSchema: Readonly<Record<string, unknown>>): AgentValueSchema {
  return {
    jsonSchema,
    parse: (input: unknown) => schema.parse(input)
  };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&#x27;/giu, "'");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim();
}

export function extractReadableWebText(rawText: string, contentType: string): string {
  if (!contentType.toLowerCase().includes("html")) {
    return rawText.trim();
  }
  return decodeHtmlEntities(
    rawText
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, " ")
      .replace(/<\/(?:p|div|section|article|li|h[1-6]|tr|br)>/giu, "\n")
      .replace(/<[^>]+>/gu, " ")
  )
    .replace(/[ \t]+/gu, " ")
    .replace(/[ \t]*\n[ \t]*/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function parseDuckDuckGoHtmlResults(html: string, maxResults: number): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = [];
  const linkRegex = /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;
  const snippetRegex =
    /<(?:a|div|td)\b[^>]*class=["'][^"']*result(?:__snippet|-snippet)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|td)>/giu;

  const links: Array<{ href: string; title: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null && links.length < maxResults) {
    let rawHref = decodeHtmlEntities(match[1] ?? "").trim();
    try {
      const maybeWrapper = new URL(rawHref, "https://duckduckgo.com");
      const uddg = maybeWrapper.searchParams.get("uddg");
      if (uddg) rawHref = uddg;
      else rawHref = maybeWrapper.toString();
    } catch {
      // Keep rawHref if already direct
    }
    const title = stripTags(match[2] ?? "");
    if (rawHref.startsWith("http") && title) {
      links.push({ href: rawHref, title });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null && snippets.length < links.length) {
    snippets.push(stripTags(match[1] ?? ""));
  }

  for (let i = 0; i < links.length; i += 1) {
    results.push({
      title: links[i]!.title,
      url: links[i]!.href,
      snippet: snippets[i] ?? ""
    });
  }
  return results;
}

const WebSearchInputSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(15).optional()
});

const WebSearchResultSchema = z.object({
  query: z.string(),
  provider: z.string(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string()
    })
  )
});

const FetchUrlInputSchema = z.object({
  url: z.string().min(1),
  maxBytes: z.number().int().min(512).max(524_288).optional()
});

const FetchUrlResultSchema = z.object({
  finalUrl: z.string(),
  status: z.number().int(),
  contentType: z.string(),
  truncated: z.boolean(),
  content: z.string()
});

async function readBodyBounded(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    return { text: "", truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        const remaining = Math.max(0, maxBytes - total);
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        total = maxBytes;
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: merged.toString("utf8"), truncated };
}

export function createWebToolDefinitions(config: WebToolsConfig = {}): AgentToolDefinition[] {
  const configuredMaxBytes = Math.max(1024, Math.min(524_288, Number(config.max_response_bytes ?? 65_536)));
  const timeoutMs = Math.max(500, Math.min(60_000, Number(config.request_timeout_ms ?? 12_000)));
  const fetchImpl = config.fetchFn ?? globalThis.fetch;
  const searchProvider: WebSearchProviderId = config.search_provider ?? "duckduckgo_html";

  return [
    {
      name: "web.search",
      description:
        "Search the web for public pages and snippets matching a query. Results carry untrusted_external taint.",
      capabilityRisk: "read_only_safe",
      resultTaint: "untrusted_external",
      inputSchema: zodValueSchema(WebSearchInputSchema, {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          maxResults: { type: "integer", minimum: 1, maximum: 15 }
        },
        additionalProperties: false
      }),
      resultSchema: zodValueSchema(WebSearchResultSchema, {
        type: "object",
        required: ["query", "provider", "results"],
        properties: {
          query: { type: "string" },
          provider: { type: "string" },
          results: {
            type: "array",
            items: {
              type: "object",
              required: ["title", "url", "snippet"],
              properties: {
                title: { type: "string" },
                url: { type: "string" },
                snippet: { type: "string" }
              }
            }
          }
        }
      }),
      async execute(call, signal) {
        const timerController = new AbortController();
        const timer = setTimeout(() => timerController.abort(new Error(`Search timed out after ${timeoutMs}ms`)), timeoutMs);
        const combinedSignal = AbortSignal.any([signal, timerController.signal]);
        try {
          const input = WebSearchInputSchema.parse(call.input);
          const maxResults = input.maxResults ?? 6;
          let results: WebSearchResultItem[] = [];

          if (searchProvider === "searxng") {
            const rawEndpoint = config.search_endpoint_url?.trim();
            if (!rawEndpoint) {
              return { status: "failed", error: "searxng requires search_endpoint_url configuration" };
            }
            const endpointUrl = config.allow_local_searxng
              ? new URL(rawEndpoint)
              : await assertSafePublicUrl(rawEndpoint, config.lookupFn);
            endpointUrl.searchParams.set("q", input.query);
            endpointUrl.searchParams.set("format", "json");
            const res = await fetchImpl(endpointUrl.toString(), {
              method: "GET",
              redirect: "error",
              headers: { Accept: "application/json", "User-Agent": "ai0-web-tools/1.1" },
              signal: combinedSignal
            });
            if (!res.ok) return { status: "failed", error: `SearXNG HTTP ${res.status}` };
            const body = JSON.parse((await readBodyBounded(res, configuredMaxBytes)).text) as {
              results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
            };
            results = (body.results ?? [])
              .filter((r) => typeof r.title === "string" && typeof r.url === "string")
              .slice(0, maxResults)
              .map((r) => ({
                title: String(r.title),
                url: String(r.url),
                snippet: typeof r.content === "string" ? stripTags(r.content) : ""
              }));
          } else if (searchProvider === "tavily") {
            const apiKey = config.search_api_key?.trim() || process.env.TAVILY_API_KEY?.trim();
            if (!apiKey) return { status: "failed", error: "tavily requires search_api_key or TAVILY_API_KEY" };
            const target = await assertSafePublicUrl("https://api.tavily.com/search", config.lookupFn);
            const res = await fetchImpl(target.toString(), {
              method: "POST",
              redirect: "error",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ api_key: apiKey, query: input.query, max_results: maxResults }),
              signal: combinedSignal
            });
            if (!res.ok) return { status: "failed", error: `Tavily HTTP ${res.status}` };
            const body = JSON.parse((await readBodyBounded(res, configuredMaxBytes)).text) as {
              results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
            };
            results = (body.results ?? [])
              .filter((r) => typeof r.title === "string" && typeof r.url === "string")
              .slice(0, maxResults)
              .map((r) => ({
                title: String(r.title),
                url: String(r.url),
                snippet: typeof r.content === "string" ? String(r.content).slice(0, 400) : ""
              }));
          } else if (searchProvider === "brave") {
            const apiKey = config.search_api_key?.trim() || process.env.BRAVE_API_KEY?.trim();
            if (!apiKey) return { status: "failed", error: "brave requires search_api_key or BRAVE_API_KEY" };
            const target = await assertSafePublicUrl(
              `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(input.query)}&count=${maxResults}`,
              config.lookupFn
            );
            const res = await fetchImpl(target.toString(), {
              method: "GET",
              redirect: "error",
              headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
              signal: combinedSignal
            });
            if (!res.ok) return { status: "failed", error: `Brave HTTP ${res.status}` };
            const body = JSON.parse((await readBodyBounded(res, configuredMaxBytes)).text) as {
              web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown }> };
            };
            results = (body.web?.results ?? [])
              .filter((r) => typeof r.title === "string" && typeof r.url === "string")
              .slice(0, maxResults)
              .map((r) => ({
                title: String(r.title),
                url: String(r.url),
                snippet: typeof r.description === "string" ? stripTags(r.description) : ""
              }));
          } else {
            const target = await assertSafePublicUrl(
              `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`,
              config.lookupFn
            );
            const res = await fetchImpl(target.toString(), {
              method: "GET",
              redirect: "error",
              headers: {
                Accept: "text/html",
                "User-Agent": "ai0-web-tools/1.1"
              },
              signal: combinedSignal
            });
            if (!res.ok) return { status: "failed", error: `DuckDuckGo HTTP ${res.status}` };
            const { text } = await readBodyBounded(res, configuredMaxBytes);
            results = parseDuckDuckGoHtmlResults(text, maxResults);
          }

          return {
            status: "verified",
            value: {
              query: input.query,
              provider: searchProvider,
              results
            }
          };
        } catch (error) {
          if (signal.aborted) throw error;
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        } finally {
          clearTimeout(timer);
        }
      },
      project: (value) => value
    },
    {
      name: "web.fetch_url",
      description:
        "Fetch readable UTF-8 text from a public HTTP/HTTPS URL with DNS-level SSRF protection. Output carries untrusted_external taint.",
      capabilityRisk: "read_only_safe",
      resultTaint: "untrusted_external",
      inputSchema: zodValueSchema(FetchUrlInputSchema, {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string" },
          maxBytes: { type: "integer", minimum: 512, maximum: 524288 }
        },
        additionalProperties: false
      }),
      resultSchema: zodValueSchema(FetchUrlResultSchema, {
        type: "object",
        required: ["finalUrl", "status", "contentType", "truncated", "content"],
        properties: {
          finalUrl: { type: "string" },
          status: { type: "integer" },
          contentType: { type: "string" },
          truncated: { type: "boolean" },
          content: { type: "string" }
        }
      }),
      async execute(call, signal) {
        const timerController = new AbortController();
        const timer = setTimeout(() => timerController.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
        const combinedSignal = AbortSignal.any([signal, timerController.signal]);
        try {
          const input = FetchUrlInputSchema.parse(call.input);
          const maxBytes = Math.min(configuredMaxBytes, input.maxBytes ?? configuredMaxBytes);
          let currentUrl = await assertSafePublicUrl(input.url, config.lookupFn);
          let hops = 0;

          while (true) {
            combinedSignal.throwIfAborted();
            const response = await fetchImpl(currentUrl.toString(), {
              method: "GET",
              redirect: "manual",
              headers: {
                Accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.5",
                "User-Agent": "ai0-web-tools/1.1"
              },
              signal: combinedSignal
            });

            if (response.status >= 300 && response.status < 400) {
              const location = response.headers.get("location");
              if (!location) {
                return { status: "failed", error: `Redirect ${response.status} missing Location header` };
              }
              hops += 1;
              if (hops > 4) {
                return { status: "failed", error: "Exceeded maximum redirect hops (4)" };
              }
              const nextCandidate = new URL(location, currentUrl).toString();
              currentUrl = await assertSafePublicUrl(nextCandidate, config.lookupFn);
              continue;
            }

            if (!response.ok) {
              return { status: "failed", error: `HTTP ${response.status} from ${currentUrl.toString()}` };
            }

            const contentType = response.headers.get("content-type") ?? "text/plain";
            const { text, truncated } = await readBodyBounded(response, maxBytes);
            const content = extractReadableWebText(text, contentType);
            return {
              status: "verified",
              value: {
                finalUrl: currentUrl.toString(),
                status: response.status,
                contentType,
                truncated,
                content
              }
            };
          }
        } catch (error) {
          if (signal.aborted) throw error;
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        } finally {
          clearTimeout(timer);
        }
      },
      project: (value) => value
    }
  ];
}

const typedManifest = rawManifest as unknown as Omit<Ai0ExtensionManifest, "manifest_version">;

export const webToolsPackage = defineExtensionPackage({
  manifest: typedManifest,
  activate(scope, rawConfig) {
    const config = (rawConfig ?? {}) as WebToolsConfig;
    scope.contributeFacet(consoleConfigSchemaFacet, {
      fields: typedManifest.console_contributions?.config_fields ?? []
    });
    scope.contributeFacet(agentToolProviderFacet, {
      tools: createWebToolDefinitions(config)
    });
  }
});

export default webToolsPackage;
