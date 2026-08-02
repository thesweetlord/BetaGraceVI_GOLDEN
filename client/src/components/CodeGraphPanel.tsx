import { useEffect, useRef, useState, useCallback } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface GraphNode {
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
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'calls' | 'imports' | 'extends' | 'implements' | 'uses' | 'exports';
}

export interface CodeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
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

interface NodePos { x: number; y: number; vx: number; vy: number; }

const NODE_COLORS: Record<string, string> = {
  function:  '#3b82f6',
  class:     '#8b5cf6',
  interface: '#06b6d4',
  type:      '#64748b',
  import:    '#6b7280',
  export:    '#f59e0b',
  variable:  '#10b981',
  hook:      '#f97316',
  component: '#ec4899',
};

const EDGE_COLORS: Record<string, string> = {
  calls:      '#3b82f6',
  imports:    '#9ca3af',
  extends:    '#8b5cf6',
  implements: '#06b6d4',
  uses:       '#10b981',
  exports:    '#f59e0b',
};

const COMPLEXITY_STYLES: Record<string, string> = {
  low:        'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  medium:     'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  high:       'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  'very-high':'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

function runForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  W: number,
  H: number,
): Record<string, NodePos> {
  if (nodes.length === 0) return {};
  const pos: Record<string, NodePos> = {};
  const R = Math.min(W, H) * 0.35;

  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
    pos[n.id] = {
      x: W / 2 + R * Math.cos(angle),
      y: H / 2 + R * Math.sin(angle),
      vx: 0,
      vy: 0,
    };
  });

  const REPULSION = 2400;
  const ATTRACTION = 0.022;
  const GRAVITY = 0.013;
  const DAMPING = 0.80;

  for (let iter = 0; iter < 200; iter++) {
    const cooling = 1 - iter / 200;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos[nodes[i].id];
        const b = pos[nodes[j].id];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (REPULSION / (dist * dist)) * cooling;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }

    edges.forEach(e => {
      const a = pos[e.from];
      const b = pos[e.to];
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = dist * ATTRACTION;
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    });

    nodes.forEach(n => {
      const p = pos[n.id];
      p.vx += (W / 2 - p.x) * GRAVITY;
      p.vy += (H / 2 - p.y) * GRAVITY;
    });

    nodes.forEach(n => {
      const p = pos[n.id];
      p.vx *= DAMPING;
      p.vy *= DAMPING;
      p.x = Math.max(44, Math.min(W - 44, p.x + p.vx));
      p.y = Math.max(28, Math.min(H - 28, p.y + p.vy));
    });
  }

  return pos;
}

interface Props {
  graph: CodeGraph;
  onClose: () => void;
}

export function CodeGraphPanel({ graph, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<Record<string, NodePos>>({});
  const [positions, setPositions] = useState<Record<string, NodePos>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string } | null>(null);
  const [dims, setDims] = useState({ w: 600, h: 300 });

  useEffect(() => {
    if (!containerRef.current) return;
    const { width } = containerRef.current.getBoundingClientRect();
    const w = Math.max(width || 600, 300);
    const h = 300;
    setDims({ w, h });
    if (graph.nodes.length === 0) { setPositions({}); return; }
    const p = runForceLayout(graph.nodes, graph.edges, w, h);
    posRef.current = { ...p };
    setPositions({ ...p });
  }, [graph]);

  const onMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setDragging({ id });
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = Math.max(44, Math.min(dims.w - 44, e.clientX - rect.left));
      const y = Math.max(28, Math.min(dims.h - 28, e.clientY - rect.top));
      posRef.current[dragging.id] = { ...posRef.current[dragging.id], x, y, vx: 0, vy: 0 };
      setPositions({ ...posRef.current });
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, dims]);

  const hoveredNode = graph.nodes.find(n => n.id === hoveredId);

  return (
    <div
      ref={containerRef}
      className="border border-cyan-500/40 bg-background/98 backdrop-blur rounded-lg overflow-hidden shadow-xl"
      data-testid="code-graph-panel"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-cyan-950/30 dark:bg-cyan-900/20 border-b border-cyan-500/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono font-bold text-cyan-400 shrink-0">CODE GRAPH</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1 border-cyan-500/50 text-cyan-300 shrink-0">
            {graph.language.toUpperCase()}
          </Badge>
          <Badge className={cn("text-[10px] h-4 px-1 shrink-0", COMPLEXITY_STYLES[graph.stats.complexity] ?? COMPLEXITY_STYLES.low)}>
            {graph.stats.complexity}
          </Badge>
          <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline truncate">
            {graph.summary.substring(0, 60)}{graph.summary.length > 60 ? '…' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden md:flex items-center gap-2 text-[10px] font-mono">
            <span className="text-blue-400">{graph.stats.totalFunctions} fn</span>
            <span className="text-purple-400">{graph.stats.totalClasses} cls</span>
            <span className="text-gray-400">{graph.stats.totalImports} imp</span>
            <span className="text-yellow-400">{graph.stats.totalExports} exp</span>
            <span className="text-muted-foreground">{graph.stats.totalLines} lines</span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">
            {graph.nodes.length}N · {graph.edges.length}E
          </span>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setCollapsed(c => !c)}>
            {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClose} data-testid="code-graph-close">
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* ── Graph Body ── */}
      {!collapsed && (
        <>
          {graph.nodes.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-xs text-muted-foreground font-mono">
              No symbols detected in the submitted code
            </div>
          ) : (
            <div className="relative bg-background/40" style={{ height: dims.h }}>
              <svg
                ref={svgRef}
                width={dims.w}
                height={dims.h}
                className="w-full block select-none"
                style={{ cursor: dragging ? 'grabbing' : 'default' }}
              >
                <defs>
                  {Object.entries(EDGE_COLORS).map(([type, color]) => (
                    <marker
                      key={type}
                      id={`cgp-arrow-${type}`}
                      markerWidth={7}
                      markerHeight={7}
                      refX={5}
                      refY={3}
                      orient="auto"
                    >
                      <path d="M0,0 L0,6 L7,3 Z" fill={color} opacity={0.75} />
                    </marker>
                  ))}
                </defs>

                {/* ── Edges ── */}
                {graph.edges.map((edge, idx) => {
                  const from = positions[edge.from];
                  const to = positions[edge.to];
                  if (!from || !to) return null;
                  const color = EDGE_COLORS[edge.type] ?? '#9ca3af';
                  const dx = to.x - from.x;
                  const dy = to.y - from.y;
                  const len = Math.sqrt(dx * dx + dy * dy) || 1;
                  const nr = 15;
                  const x1 = from.x + (dx / len) * nr;
                  const y1 = from.y + (dy / len) * nr;
                  const x2 = to.x - (dx / len) * (nr + 7);
                  const y2 = to.y - (dy / len) * (nr + 7);
                  return (
                    <line
                      key={`${edge.from}-${edge.to}-${idx}`}
                      x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={color}
                      strokeWidth={edge.type === 'extends' || edge.type === 'implements' ? 2 : 1.2}
                      strokeDasharray={
                        edge.type === 'imports' ? '5 3' :
                        edge.type === 'uses' ? '2 2' :
                        undefined
                      }
                      markerEnd={`url(#cgp-arrow-${edge.type})`}
                      opacity={0.6}
                    />
                  );
                })}

                {/* ── Nodes ── */}
                {graph.nodes.map(node => {
                  const p = positions[node.id];
                  if (!p) return null;
                  const color = NODE_COLORS[node.type] ?? '#6b7280';
                  const isHov = hoveredId === node.id;
                  const r = 15;
                  const label = node.name.length > 14 ? node.name.slice(0, 12) + '…' : node.name;
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${p.x},${p.y})`}
                      style={{ cursor: dragging?.id === node.id ? 'grabbing' : 'grab' }}
                      onMouseDown={e => onMouseDown(e, node.id)}
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <circle
                        r={isHov ? r + 3 : r}
                        fill={color}
                        fillOpacity={isHov ? 0.95 : 0.80}
                        stroke={isHov ? '#ffffff' : 'rgba(255,255,255,0.25)'}
                        strokeWidth={isHov ? 2.5 : 1}
                      />
                      {node.exported && (
                        <circle
                          r={isHov ? r + 6 : r + 3}
                          fill="none"
                          stroke="#fbbf24"
                          strokeWidth={1}
                          strokeDasharray="3 2"
                          opacity={0.55}
                        />
                      )}
                      <text
                        textAnchor="middle"
                        dy="0.35em"
                        fontSize={8.5}
                        fill="#fff"
                        fontFamily="monospace"
                        pointerEvents="none"
                        style={{ userSelect: 'none' }}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* ── Hover Tooltip ── */}
              {hoveredNode && (() => {
                const p = positions[hoveredNode.id];
                if (!p) return null;
                const left = Math.min(p.x + 20, dims.w - 210);
                const top = Math.max(4, p.y - 20);
                return (
                  <div
                    className="absolute pointer-events-none bg-background/95 border border-border rounded-md px-2 py-1.5 text-[10px] font-mono shadow-xl z-20 w-[200px]"
                    style={{ left, top }}
                  >
                    <div className="font-bold text-foreground truncate">{hoveredNode.name}</div>
                    <div className="text-muted-foreground capitalize flex items-center gap-1">
                      <span
                        className="w-2 h-2 rounded-full inline-block shrink-0"
                        style={{ background: NODE_COLORS[hoveredNode.type] ?? '#6b7280' }}
                      />
                      {hoveredNode.type}
                      {hoveredNode.async && <span className="text-blue-400 ml-1">async</span>}
                    </div>
                    {hoveredNode.signature && (
                      <div className="text-cyan-400 truncate mt-0.5">{hoveredNode.signature}</div>
                    )}
                    {hoveredNode.params && hoveredNode.params.length > 0 && (
                      <div className="text-muted-foreground mt-0.5">
                        ({hoveredNode.params.slice(0, 3).join(', ')}{hoveredNode.params.length > 3 ? ', …' : ''})
                      </div>
                    )}
                    {hoveredNode.returnType && (
                      <div className="text-green-400">→ {hoveredNode.returnType}</div>
                    )}
                    {hoveredNode.line !== undefined && (
                      <div className="text-muted-foreground">line {hoveredNode.line}</div>
                    )}
                    {hoveredNode.exported && <div className="text-yellow-400">⬡ exported</div>}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Legend ── */}
          <div className="px-3 py-1 border-t border-border/40 flex flex-wrap gap-x-3 gap-y-0.5 bg-muted/20">
            {Object.entries(NODE_COLORS).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1 text-[9px] text-muted-foreground">
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: color }} />
                {type}
              </span>
            ))}
            <span className="flex items-center gap-1 text-[9px] text-muted-foreground ml-auto">
              <span className="w-3 h-[1px] inline-block border-t-2 border-dashed border-gray-400" />
              imports
            </span>
            <span className="flex items-center gap-1 text-[9px] text-yellow-600">
              ⬡ exported
            </span>
            <span className="text-[9px] text-muted-foreground italic">drag nodes to rearrange</span>
          </div>
        </>
      )}
    </div>
  );
}
