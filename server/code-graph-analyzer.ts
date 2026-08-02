/**
 * CodeGraph Analyzer — server-side code intelligence engine
 * Inspired by github.com/colbymchenry/codegraph
 *
 * Parses source code and extracts a semantic knowledge graph:
 * functions, classes, imports, exports, call relationships, and dependencies.
 * Works on JS/TS/Python/Go/Rust/Java — no binary dependencies required.
 */

export interface CodeNode {
  id: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'import' | 'export' | 'variable' | 'hook' | 'component';
  name: string;
  line?: number;
  signature?: string;
  exported: boolean;
  async?: boolean;
  params?: string[];
  returnType?: string;
  extends?: string;
  implements?: string[];
  decorators?: string[];
}

export interface CodeEdge {
  from: string;
  to: string;
  type: 'calls' | 'imports' | 'extends' | 'implements' | 'uses' | 'exports';
}

export interface CodeGraph {
  nodes: CodeNode[];
  edges: CodeEdge[];
  language: string;
  stats: {
    totalFunctions: number;
    totalClasses: number;
    totalImports: number;
    totalExports: number;
    totalLines: number;
    complexity: 'low' | 'medium' | 'high' | 'very-high';
  };
  summary: string;
}

function detectLanguage(code: string, hint?: string): string {
  if (hint) {
    const h = hint.toLowerCase();
    if (h.includes('python') || h.includes('.py')) return 'python';
    if (h.includes('typescript') || h.includes('.ts')) return 'typescript';
    if (h.includes('javascript') || h.includes('.js')) return 'javascript';
    if (h.includes('rust') || h.includes('.rs')) return 'rust';
    if (h.includes('go') || h.includes('.go')) return 'go';
    if (h.includes('java') || h.includes('.java')) return 'java';
    if (h.includes('css') || h.includes('.css')) return 'css';
  }
  if (code.includes('def ') && code.includes(':')) {
    const pySignals = ['def ', 'import ', 'from ', 'self.', 'elif ', 'print(', '__init__', '__name__', 'None', 'True', 'False'].filter(s => code.includes(s)).length;
    const jsSignals = ['=>', 'const ', 'let ', 'var ', 'function ', '===', '!==', 'undefined'].filter(s => code.includes(s)).length;
    if (pySignals >= jsSignals) return 'python';
  }
  if (code.includes(': string') || code.includes(': number') || code.includes('interface ') || code.includes('type ') || code.includes(': void')) return 'typescript';
  if (code.includes('fn ') && code.includes('->') && code.includes('let mut')) return 'rust';
  if (code.includes('func ') && code.includes('package ')) return 'go';
  if (code.includes('public class') || code.includes('private void')) return 'java';
  return 'javascript';
}

function generateId(name: string, type: string, line?: number): string {
  return `${type}:${name}${line ? `:${line}` : ''}`;
}

function extractJSTS(code: string, language: string): { nodes: CodeNode[]; edges: CodeEdge[] } {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const lines = code.split('\n');

  // Extract imports
  const importRe = /^import\s+(?:(?:type\s+)?(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:\{([^}]+)\}|(\w+)))*)\s+from\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(code)) !== null) {
    const source = m[6];
    const names: string[] = [];
    if (m[1]) names.push(...m[1].split(',').map(s => s.trim().replace(/\s+as\s+\w+/, '')).filter(Boolean));
    if (m[2]) names.push(m[2]);
    if (m[3]) names.push(m[3]);
    if (m[4]) names.push(...m[4].split(',').map(s => s.trim().replace(/\s+as\s+\w+/, '')).filter(Boolean));
    if (m[5]) names.push(m[5]);

    for (const name of names) {
      if (!name) continue;
      const id = generateId(name, 'import');
      if (!nodes.find(n => n.id === id)) {
        nodes.push({ id, type: 'import', name, exported: false, signature: `import ${name} from '${source}'` });
        edges.push({ from: id, to: `module:${source}`, type: 'imports' });
      }
    }
  }

  // Extract function declarations (named, arrow, async, React hooks/components)
  const funcRe = /(?:^|\s)(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*(\w+)\s*(\([^)]*\))(?:\s*:\s*([^\{]+))?/gm;
  while ((m = funcRe.exec(code)) !== null) {
    const exported = !!m[1];
    const isAsync = !!m[3];
    const name = m[4];
    const params = m[5] ? [m[5].slice(1, -1).trim()] : [];
    const returnType = m[6]?.trim();
    const line = code.slice(0, m.index).split('\n').length;
    const isHook = name.startsWith('use') && name.length > 3 && name[3] === name[3].toUpperCase();
    const isComponent = /^[A-Z]/.test(name);
    const type = isHook ? 'hook' : isComponent ? 'component' : 'function';
    const id = generateId(name, type, line);
    nodes.push({ id, type, name, line, exported, async: isAsync, params, returnType, signature: `${isAsync ? 'async ' : ''}function ${name}${m[5]}${returnType ? ': ' + returnType : ''}` });
  }

  // Arrow function assignments: const foo = () => / const Foo = () =>
  const arrowRe = /(?:^|\s)(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?(?:\([^)]*\)|[^=])\s*=>/gm;
  while ((m = arrowRe.exec(code)) !== null) {
    const exported = !!m[1];
    const name = m[3];
    const isAsync = !!m[4];
    if (nodes.find(n => n.name === name)) continue;
    const line = code.slice(0, m.index).split('\n').length;
    const isHook = name.startsWith('use') && name.length > 3 && name[3] === name[3].toUpperCase();
    const isComponent = /^[A-Z]/.test(name);
    const type = isHook ? 'hook' : isComponent ? 'component' : 'function';
    const id = generateId(name, type, line);
    nodes.push({ id, type, name, line, exported, async: isAsync, signature: `const ${name} = ${isAsync ? 'async ' : ''}(...) => {...}` });
  }

  // Classes
  const classRe = /(?:^|\s)(export\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?\s*\{/gm;
  while ((m = classRe.exec(code)) !== null) {
    const exported = !!m[1];
    const name = m[3];
    const extendsClass = m[4];
    const implementsInterfaces = m[5]?.split(',').map(s => s.trim()).filter(Boolean);
    const line = code.slice(0, m.index).split('\n').length;
    const id = generateId(name, 'class', line);
    nodes.push({ id, type: 'class', name, line, exported, extends: extendsClass, implements: implementsInterfaces, signature: `class ${name}${extendsClass ? ` extends ${extendsClass}` : ''}${implementsInterfaces?.length ? ` implements ${implementsInterfaces.join(', ')}` : ''}` });
    if (extendsClass) edges.push({ from: id, to: generateId(extendsClass, 'class'), type: 'extends' });
    if (implementsInterfaces) for (const iface of implementsInterfaces) edges.push({ from: id, to: generateId(iface, 'interface'), type: 'implements' });
  }

  // Interfaces (TypeScript)
  if (language === 'typescript') {
    const ifaceRe = /(?:^|\s)(export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?\s*\{/gm;
    while ((m = ifaceRe.exec(code)) !== null) {
      const exported = !!m[1];
      const name = m[2];
      const line = code.slice(0, m.index).split('\n').length;
      const id = generateId(name, 'interface', line);
      nodes.push({ id, type: 'interface', name, line, exported, signature: `interface ${name}` });
    }

    // Type aliases
    const typeRe = /(?:^|\s)(export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/gm;
    while ((m = typeRe.exec(code)) !== null) {
      const exported = !!m[1];
      const name = m[2];
      if (name === 'default') continue;
      const line = code.slice(0, m.index).split('\n').length;
      const id = generateId(name, 'type', line);
      nodes.push({ id, type: 'type', name, line, exported, signature: `type ${name} = ...` });
    }
  }

  // Build call graph: find which functions call which
  const functionNodes = nodes.filter(n => ['function', 'hook', 'component', 'class'].includes(n.type));
  for (const fn of functionNodes) {
    for (const other of nodes) {
      if (other.id === fn.id) continue;
      if (other.type === 'import' || other.type === 'export') continue;
      const callPattern = new RegExp(`\\b${other.name}\\s*\\(`, 'g');
      const fnStart = code.indexOf(`function ${fn.name}`) || code.indexOf(`const ${fn.name}`);
      if (fnStart !== -1 && callPattern.test(code.slice(fnStart, fnStart + 800))) {
        edges.push({ from: fn.id, to: other.id, type: 'calls' });
      }
    }
  }

  // Named exports
  const namedExportRe = /export\s*\{\s*([^}]+)\}/gm;
  while ((m = namedExportRe.exec(code)) !== null) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    for (const name of names) {
      const existingNode = nodes.find(n => n.name === name);
      if (existingNode) existingNode.exported = true;
    }
  }

  return { nodes, edges };
}

function extractPython(code: string): { nodes: CodeNode[]; edges: CodeEdge[] } {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const lines = code.split('\n');

  // Imports
  const importRe = /^(?:from\s+([\w.]+)\s+import\s+([\w,\s*]+)|import\s+([\w,\s]+))/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(code)) !== null) {
    const source = m[1] || '';
    const names = (m[2] || m[3] || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const name of names) {
      const id = generateId(name, 'import');
      if (!nodes.find(n => n.id === id)) {
        nodes.push({ id, type: 'import', name, exported: false, signature: source ? `from ${source} import ${name}` : `import ${name}` });
      }
    }
  }

  // Functions
  const funcRe = /^(    |\t)*(async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\w+))?:/gm;
  while ((m = funcRe.exec(code)) !== null) {
    const indent = m[1] || '';
    const isAsync = !!m[2];
    const name = m[3];
    const params = m[4] ? [m[4].trim()] : [];
    const returnType = m[5];
    const line = code.slice(0, m.index).split('\n').length;
    const id = generateId(name, 'function', line);
    nodes.push({ id, type: 'function', name, line, exported: !indent, async: isAsync, params, returnType, signature: `${isAsync ? 'async ' : ''}def ${name}(${m[4]})${returnType ? ' -> ' + returnType : ''}` });
  }

  // Classes
  const classRe = /^class\s+(\w+)(?:\(([^)]+)\))?:/gm;
  while ((m = classRe.exec(code)) !== null) {
    const name = m[1];
    const extendsClass = m[2]?.split(',')[0]?.trim();
    const line = code.slice(0, m.index).split('\n').length;
    const id = generateId(name, 'class', line);
    nodes.push({ id, type: 'class', name, line, exported: true, extends: extendsClass, signature: `class ${name}${extendsClass ? `(${extendsClass})` : ''}` });
  }

  return { nodes, edges };
}

export function analyzeCode(code: string, languageHint?: string): CodeGraph {
  const language = detectLanguage(code, languageHint);
  const lines = code.split('\n');

  let extraction: { nodes: CodeNode[]; edges: CodeEdge[] };

  if (language === 'python') {
    extraction = extractPython(code);
  } else {
    extraction = extractJSTS(code, language);
  }

  const { nodes, edges } = extraction;

  // Deduplicate nodes by id
  const seen = new Set<string>();
  const uniqueNodes = nodes.filter(n => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });

  // Deduplicate edges
  const edgeSeen = new Set<string>();
  const uniqueEdges = edges.filter(e => {
    const key = `${e.from}→${e.to}:${e.type}`;
    if (edgeSeen.has(key)) return false;
    edgeSeen.add(key);
    return true;
  });

  const totalFunctions = uniqueNodes.filter(n => ['function', 'hook', 'component'].includes(n.type)).length;
  const totalClasses = uniqueNodes.filter(n => n.type === 'class').length;
  const totalImports = uniqueNodes.filter(n => n.type === 'import').length;
  const totalExports = uniqueNodes.filter(n => n.exported).length;

  const complexityScore = totalFunctions + totalClasses * 2 + totalImports;
  const complexity: 'low' | 'medium' | 'high' | 'very-high' =
    complexityScore < 5 ? 'low' :
    complexityScore < 15 ? 'medium' :
    complexityScore < 30 ? 'high' : 'very-high';

  const exportedItems = uniqueNodes.filter(n => n.exported).map(n => n.name);
  const summary = `${language.toUpperCase()} codebase — ${lines.length} lines, ${totalFunctions} function${totalFunctions !== 1 ? 's' : ''}, ${totalClasses} class${totalClasses !== 1 ? 'es' : ''}, ${totalImports} import${totalImports !== 1 ? 's' : ''}. Complexity: ${complexity}. Exported: ${exportedItems.length > 0 ? exportedItems.slice(0, 8).join(', ') + (exportedItems.length > 8 ? '...' : '') : 'none'}.`;

  return {
    nodes: uniqueNodes,
    edges: uniqueEdges,
    language,
    stats: { totalFunctions, totalClasses, totalImports, totalExports, totalLines: lines.length, complexity },
    summary,
  };
}

export function formatGraphForAI(graph: CodeGraph): string {
  const parts: string[] = [];
  parts.push(`[CODE KNOWLEDGE GRAPH — ${graph.language.toUpperCase()}]`);
  parts.push(`Summary: ${graph.summary}`);
  parts.push('');

  const imports = graph.nodes.filter(n => n.type === 'import');
  if (imports.length) {
    parts.push(`IMPORTS (${imports.length}):`);
    for (const n of imports.slice(0, 20)) parts.push(`  • ${n.signature}`);
    if (imports.length > 20) parts.push(`  ... and ${imports.length - 20} more`);
    parts.push('');
  }

  const functions = graph.nodes.filter(n => ['function', 'hook', 'component'].includes(n.type));
  if (functions.length) {
    parts.push(`FUNCTIONS/COMPONENTS (${functions.length}):`);
    for (const n of functions) {
      const exported = n.exported ? ' [exported]' : '';
      const async_ = n.async ? ' async' : '';
      parts.push(`  • ${n.type === 'component' ? '⚛' : n.type === 'hook' ? '🪝' : 'ƒ'} ${n.signature || n.name}${exported}${async_}${n.line ? ` (line ${n.line})` : ''}`);
    }
    parts.push('');
  }

  const classes = graph.nodes.filter(n => n.type === 'class');
  if (classes.length) {
    parts.push(`CLASSES (${classes.length}):`);
    for (const n of classes) {
      parts.push(`  • ${n.signature || n.name}${n.exported ? ' [exported]' : ''}${n.line ? ` (line ${n.line})` : ''}`);
    }
    parts.push('');
  }

  const types = graph.nodes.filter(n => ['interface', 'type'].includes(n.type));
  if (types.length) {
    parts.push(`TYPES/INTERFACES (${types.length}):`);
    for (const n of types) parts.push(`  • ${n.signature || n.name}${n.exported ? ' [exported]' : ''}`);
    parts.push('');
  }

  const callEdges = graph.edges.filter(e => e.type === 'calls');
  if (callEdges.length) {
    parts.push(`CALL RELATIONSHIPS (${callEdges.length}):`);
    for (const e of callEdges.slice(0, 15)) {
      const fromName = e.from.split(':')[1];
      const toName = e.to.split(':')[1];
      parts.push(`  • ${fromName} → calls → ${toName}`);
    }
    if (callEdges.length > 15) parts.push(`  ... and ${callEdges.length - 15} more`);
    parts.push('');
  }

  return parts.join('\n');
}
