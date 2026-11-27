import { cognitionMemoryProviderFacet, taskExecutorContract, type ExtensionCoreHost } from "@ai0/sdk";
import { readSoulProfileConfig, type HybridMemoryRetriever } from "@ai0/storage";
import type { VirtualClock } from "@ai0/cognition-core";
import type { CognitionMemoryTier } from "@ai0/protocol";
import type { Ai0DaemonRuntime } from "./index.js";
import { allowedCollections, searchKnowledge } from "./knowledge-service.js";

function normalizeMemoryTier(tier: string): CognitionMemoryTier {
  if (
    tier === "episodic_trace" ||
    tier === "perceptual_hypothesis" ||
    tier === "non_literal_frame" ||
    tier === "semantic_fact"
  ) {
    return tier;
  }
  return "episodic_trace";
}

/** Bridge the active Soul's SQLite HybridMemoryRetriever as a standard `cognition.memory_provider@1` facet. */
export function mountSoulMemoryProvider(
  host: ExtensionCoreHost,
  getRetriever: () => HybridMemoryRetriever,
  clock: VirtualClock
) {
  if (host.getPackage("host.soul-memory")) return;
  host.mountPackage({
    manifest: {
      extension_id: "host.soul-memory",
      display_name: "灵魂混合记忆检索提供方",
      version: "1.0.0",
      author: "ai0",
      manifest_version: "2.0.0",
      carrier_kind: "native_code_plugin",
      facets: ["cognition.memory_provider"],
      permissions: {
        read_blackboard_domains: ["D3_MEMORY_PROJECTION"],
        propose_mutation_domains: [],
        max_audience_scope: "public_all",
        network_access: false
      }
    },
    activate(scope) {
      scope.contributeFacet(cognitionMemoryProviderFacet, {
        priority: 0,
        retrieve(query) {
          const result = getRetriever().retrieve({
            query_text: query.query,
            audience_scope: query.audienceScope,
            principal_trust: query.audienceScope === "only_owner" ? "owner_verified" : "stranger",
            current_virtual_ts: clock.nowMs()
          });
          return result.recalled_memories
            .map((mem) => ({
              memoryId: mem.memory_id,
              content: mem.content_text,
              memoryTier: normalizeMemoryTier(mem.memory_tier),
              audienceScope: mem.visibility_scope,
              createdAtMs: clock.nowMs(),
              score: mem.score
            }))
            .filter((item) => !query.tiers?.length || query.tiers.includes(item.memoryTier))
            .slice(0, query.limit ?? 8);
        }
      });
    }
  });
}

/** The host's read grant is restricted to owner-visible, mounted collections. */
export function mountKnowledgeTaskExecutor(host: ExtensionCoreHost, runtime: Ai0DaemonRuntime) {
  const ref = { owner: "host.knowledge", name: "search", version: 1 };
  const contract = taskExecutorContract(ref);
  host.mountPackage({
    manifest: {
      extension_id: ref.owner, display_name: "知识库检索", version: "1", author: "ai0",
      manifest_version: "2.0.0", carrier_kind: "native_code_plugin", facets: [],
      permissions: { read_blackboard_domains: [], propose_mutation_domains: [], max_audience_scope: "only_owner", network_access: false },
      services: { defines: [ref], provides: [ref] }
    },
    activate(scope) {
      scope.defineService(contract);
      scope.provideService(contract, async ({ title, allowedTools }) => {
        if (!allowedTools.includes("rag.search_docs")) throw new Error("Knowledge retrieval permission denied");
        const cfg = readSoulProfileConfig(runtime.soulDir);
        const mounted = cfg.profiles.find(profile => profile.id === cfg.defaultProfileId)?.knowledgeCollectionIds ?? [];
        const result = await searchKnowledge(runtime, runtime.storage, title, allowedCollections(runtime.storage, mounted, "only_owner", true));
        const hits = result.results.filter(hit => hit.score >= cfg.capabilities.knowledge.honestForgetThreshold);
        return { summary: "知识库检索完成，返回 " + hits.length + " 个片段", evidence: { query: title, chunk_ids: hits.map(hit => hit.chunkId) } };
      });
    }
  });
}
