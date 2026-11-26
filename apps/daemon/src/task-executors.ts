import { taskExecutorContract, type ExtensionCoreHost } from "@ai0/sdk";
import { readSoulProfileConfig } from "@ai0/storage";
import type { Ai0DaemonRuntime } from "./index.js";
import { allowedCollections, searchKnowledge } from "./knowledge-service.js";

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
