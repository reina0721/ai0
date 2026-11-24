export interface KnowledgeSource {
  chunkId: string;
  collectionId: string;
  documentId: string;
  title: string;
  location: string;
  excerpt: string;
  taint_level: "untrusted_external";
}

export interface KnowledgeCitation extends KnowledgeSource {
  marker: number;
}

/** Optional evidence metadata on Shell run, history and perception responses. */
export interface ShellKnowledgeReferences {
  sources?: KnowledgeCitation[];
}

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
