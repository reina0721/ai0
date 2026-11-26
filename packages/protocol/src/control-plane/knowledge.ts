import { z } from "zod";

const KnowledgeSourceSchema = z.object({
  chunkId: z.string(),
  collectionId: z.string(),
  documentId: z.string(),
  title: z.string(),
  location: z.string(),
  excerpt: z.string(),
  taint_level: z.literal("untrusted_external")
});
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;

const KnowledgeCitationSchema = KnowledgeSourceSchema.extend({ marker: z.number() });
export type KnowledgeCitation = z.infer<typeof KnowledgeCitationSchema>;

/** Optional evidence metadata on channel run, history and perception responses. */
export const ChannelKnowledgeReferencesSchema = z.object({ sources: z.array(KnowledgeCitationSchema).optional() });
export type ChannelKnowledgeReferences = z.infer<typeof ChannelKnowledgeReferencesSchema>;

export interface KnowledgeCollection {
  id: string;
  name: string;
  audience: string;
  documents: number;
  searchableDocuments: number;
  chunks: number;
  citations: number;
  warnings: number;
  errors: number;
}

export interface KnowledgeDocument {
  id: string;
  name: string;
  revision: number;
  warning: string;
  chunks: number;
}

export interface KnowledgeHit extends KnowledgeSource {
  score: number;
  bm25: number | null;
  denseSim: number | null;
  rerankScore: number | null;
}

export interface KnowledgeSearch {
  results: KnowledgeHit[];
  stages: string[];
  warnings: string[];
  honestForgetTriggered: boolean;
}
