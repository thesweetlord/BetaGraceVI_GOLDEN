import * as fs from 'fs';
import * as path from 'path';
import Graph from 'graphology';
import * as child_process from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(child_process.exec);

const ALETHEIA_DATA_DIR = path.join(process.cwd(), 'aletheia', 'data');

interface GraphEdge {
  weight: number;
  sources: string[];
  last_updated: string;
}

let knowledgeGraph: Graph | null = null;
let chromaStore: any = null;
let hasEmbeddingSupport: boolean | null = null;

async function findPythonCommand(): Promise<string> {
  const candidates = process.platform === 'win32' ? ['py -3', 'python', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      await execAsync(`${cmd} --version`);
      return cmd;
    } catch {
      continue;
    }
  }
  throw new Error('Python executable not found');
}

async function embedText(text: string): Promise<number[] | null> {
  if (text.trim().length === 0) return null;
  if (hasEmbeddingSupport === false) return null;

  try {
    const python = await findPythonCommand();
    const { stdout } = await execAsync(
      `${python} -c "import sys, json; from sentence_transformers import SentenceTransformer; model = SentenceTransformer('all-MiniLM-L6-v2'); vec = model.encode(sys.argv[1], normalize_embeddings=True).tolist(); print(json.dumps(vec))" ${JSON.stringify(text)}`,
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
    );
    const embedding = JSON.parse(stdout.trim());
    if (Array.isArray(embedding)) {
      hasEmbeddingSupport = true;
      return embedding;
    }
  } catch (err) {
    hasEmbeddingSupport = false;
    console.warn('[AletheiaBridge] Embedding fallback: Python sentence-transformers unavailable', err);
  }

  return null;
}

/**
 * Load Aletheia knowledge graph from pickle (self-sustaining local cache)
 */
export async function loadKnowledgeGraph(): Promise<Graph> {
  if (knowledgeGraph) return knowledgeGraph;

  const graphPath = path.join(ALETHEIA_DATA_DIR, 'graph.pkl');
  if (!fs.existsSync(graphPath)) {
    console.warn('[AletheiaBridge] graph.pkl not found, using empty graph');
    knowledgeGraph = new Graph();
    return knowledgeGraph;
  }

  try {
    // Fallback: Spawn Python for pickle load (self-sustaining)
    const python = await findPythonCommand();
    const graphPathLiteral = JSON.stringify(graphPath).replace(/"/g, '\\"');
    const { stdout, stderr } = await execAsync(`${python} -c "
import pickle
import sys, json
with open(json.loads(\"${graphPathLiteral}\"), 'rb') as f:
  g = pickle.load(f)
nodes = dict(g.nodes(data=True))
edges = []
for u, v, attrs in g.edges(data=True):
  edges.append({ 'source': str(u), 'target': str(v), 'attrs': attrs })
print(json.dumps({'nodes': nodes, 'edges': edges}))
"`, {
      timeout: 20000,
      maxBuffer: 20 * 1024 * 1024,
    });
    const output = stdout.trim();
    if (!output) {
      throw new Error(`Python graph loader produced no output${stderr ? `; stderr: ${stderr.trim()}` : ''}`);
    }
    let data: any;
    try {
      data = JSON.parse(output);
    } catch (parseError) {
      throw new Error(`Failed to parse graph loader JSON output: ${parseError instanceof Error ? parseError.message : String(parseError)}; output=${output.slice(0, 1000)}`);
    }
    knowledgeGraph = new Graph();

    // Parse NetworkX → Graphology
    // Nodes
    for (const [node, attrs] of Object.entries(data.nodes || {})) {
      knowledgeGraph.addNode((node as string).toLowerCase(), attrs as any);
    }
    // Edges
    for (const edge of data.edges || []) {
      const source = String(edge.source).toLowerCase();
      const target = String(edge.target).toLowerCase();
      if (!knowledgeGraph.hasNode(source)) {
        knowledgeGraph.addNode(source);
      }
      if (!knowledgeGraph.hasNode(target)) {
        knowledgeGraph.addNode(target);
      }
      if (!knowledgeGraph.hasEdge(source, target)) {
        knowledgeGraph.addEdge(source, target, edge.attrs as GraphEdge);
      }
    }

    console.log(`[AletheiaBridge] Loaded graph: ${knowledgeGraph.order} nodes, ${knowledgeGraph.size} edges`);
    return knowledgeGraph;
  } catch (error) {
    console.warn('[AletheiaBridge] Failed to load graph.pkl, using empty graph:', error);
    knowledgeGraph = new Graph();
    return knowledgeGraph;
  }
}

/**
 * Query graph neighbors for RAG context
 */
export async function queryGraph(entity: string, topK: number = 10): Promise<Array<{neighbor: string; weight: number; sources: string[]}> > {
  const g = await loadKnowledgeGraph();
  const lowerEntity = entity.toLowerCase();

  if (!g.hasNode(lowerEntity)) {
    return [];
  }

  const neighbors = g.neighbors(lowerEntity);
  const results = neighbors.slice(0, topK).map((nb: string) => {
    const edge = g.getEdgeAttributes(lowerEntity, nb);
    return {
      neighbor: nb,
      weight: (edge as any).weight || 1,
      sources: (edge as any).sources || [],
    };
  });

  return results.sort((a: any, b: any) => b.weight - a.weight);
}

/**
 * Load Chroma vector store (local sqlite3)
 */
export async function loadChroma(): Promise<any> {
  if (chromaStore) return chromaStore;

  const chromaPath = path.join(ALETHEIA_DATA_DIR, 'chroma');
  // Note: Litefs is not a real class, this is placeholder
  chromaStore = { path: chromaPath };
  console.log('[AletheiaBridge] Chroma loaded from', chromaPath);
  return chromaStore;
}

/**
 * RAG query Chroma (embed + similarity)
 */
export async function queryChroma(query: string, topK: number = 5): Promise<string[]> {
  const chromaPath = path.join(ALETHEIA_DATA_DIR, 'chroma');
  if (!fs.existsSync(chromaPath)) {
    console.warn('[AletheiaBridge] Chroma path not found');
    return [];
  }

  try {
    // Embed query
    const queryEmbedding = await embedText(query);
    if (!queryEmbedding) {
      console.warn('[AletheiaBridge] Query embedding unavailable; skipping Chroma search');
      return [];
    }

    // Query Chroma via Python
    const python = await findPythonCommand();
    const chromaPathLiteral = JSON.stringify(chromaPath).replace(/"/g, '\\"');
    const { stdout } = await execAsync(
      `${python} -c "
import chromadb
import numpy as np
import json

client = chromadb.PersistentClient(path=json.loads(\"${chromaPathLiteral}\"))
collection = client.get_or_create_collection('documents')

results = collection.query(
  query_embeddings=[${JSON.stringify(queryEmbedding)}],
  n_results=${topK}
)

documents = results.get('documents', [[]])[0] if results.get('documents') else []
print(json.dumps(documents))
"`,
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
    );

    const documents = JSON.parse(stdout.trim());
    return documents;
  } catch (e) {
    console.error('[AletheiaBridge] Chroma query failed:', e);
    return [];
  }
}

/**
 * Health check endpoint data
 */
export function getAletheiaStats() {
  return {
    graphLoaded: !!knowledgeGraph,
    graphNodes: knowledgeGraph?.order || 0,
    graphEdges: knowledgeGraph?.size || 0,
    chromaLoaded: !!chromaStore,
  };
}

