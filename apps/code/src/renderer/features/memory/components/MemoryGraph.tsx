import { Box, Flex, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { useMemoryGraph } from "../hooks/useMemoryEntries";
import { useMemoryStore } from "../stores/memoryStore";

interface Position {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const TYPE_COLORS: Record<string, string> = {
  person: "#3b82f6",
  context: "#22c55e",
  project: "#f97316",
  glossary: "#a855f7",
  preference: "#14b8a6",
  reference: "#6b7280",
  feedback: "#f59e0b",
};

const DEFAULT_COLOR = "#6b7280";

function getColor(type: string): string {
  return TYPE_COLORS[type] ?? DEFAULT_COLOR;
}

export function MemoryGraph() {
  const { data: graph, isLoading } = useMemoryGraph();
  const selectedPath = useMemoryStore((s) => s.selectedPath);
  const selectEntry = useMemoryStore((s) => s.selectEntry);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 500 });
  const posRef = useRef<Map<string, Position>>(new Map());
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({
          w: entry.contentRect.width,
          h: entry.contentRect.height,
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return;
    const { w, h } = size;
    const cx = w / 2;
    const cy = h / 2;

    for (const node of graph.nodes) {
      if (!posRef.current.has(node.id)) {
        const angle = Math.random() * 2 * Math.PI;
        const r = 80 + Math.random() * 100;
        posRef.current.set(node.id, {
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
          vx: 0,
          vy: 0,
        });
      }
    }

    let alpha = 1;
    const REPULSION = 2000;
    const LINK_DIST = 120;
    const DAMPING = 0.85;
    const GRAVITY = 0.03;

    const simulate = () => {
      if (alpha < 0.005) return;
      alpha *= 0.99;

      const { nodes, edges } = graph;

      for (let i = 0; i < nodes.length; i++) {
        const pi = posRef.current.get(nodes[i].id);
        if (!pi) continue;
        for (let j = i + 1; j < nodes.length; j++) {
          const pj = posRef.current.get(nodes[j].id);
          if (!pj) continue;
          const dx = pj.x - pi.x;
          const dy = pj.y - pi.y;
          const dist2 = dx * dx + dy * dy + 1;
          const force = (REPULSION * alpha) / dist2;
          const d = Math.sqrt(dist2);
          const fx = (dx / d) * force;
          const fy = (dy / d) * force;
          pi.vx -= fx;
          pi.vy -= fy;
          pj.vx += fx;
          pj.vy += fy;
        }
      }

      for (const edge of edges) {
        const ps = posRef.current.get(edge.source);
        const pt = posRef.current.get(edge.target);
        if (!ps || !pt) continue;
        const dx = pt.x - ps.x;
        const dy = pt.y - ps.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = ((dist - LINK_DIST) * 0.1 * alpha) / dist;
        ps.vx += dx * force;
        ps.vy += dy * force;
        pt.vx -= dx * force;
        pt.vy -= dy * force;
      }

      for (const node of nodes) {
        const p = posRef.current.get(node.id);
        if (!p) continue;
        p.vx += (cx - p.x) * GRAVITY * alpha;
        p.vy += (cy - p.y) * GRAVITY * alpha;
        p.vx *= DAMPING;
        p.vy *= DAMPING;
        p.x += p.vx;
        p.y += p.vy;
        p.x = Math.max(20, Math.min(w - 20, p.x));
        p.y = Math.max(20, Math.min(h - 20, p.y));
      }

      draw();
      rafRef.current = requestAnimationFrame(simulate);
    };

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(150,150,150,0.25)";
      ctx.lineWidth = 1;
      for (const edge of graph.edges) {
        const ps = posRef.current.get(edge.source);
        const pt = posRef.current.get(edge.target);
        if (!ps || !pt) continue;
        ctx.beginPath();
        ctx.moveTo(ps.x, ps.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
      }

      for (const node of graph.nodes) {
        const p = posRef.current.get(node.id);
        if (!p) continue;
        const isSelected = selectedPath === node.id;
        const color = getColor(node.type);
        const r = isSelected ? 9 : 7;

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();

        if (isSelected) {
          ctx.strokeStyle = "white";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "11px system-ui";
        ctx.fillText(node.label.slice(0, 20), p.x + 11, p.y + 4);
      }
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(simulate);

    return () => cancelAnimationFrame(rafRef.current);
  }, [graph, size, selectedPath]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!graph) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const HIT = 12;

    for (const node of graph.nodes) {
      const p = posRef.current.get(node.id);
      if (!p) continue;
      if (Math.abs(p.x - mx) < HIT && Math.abs(p.y - my) < HIT) {
        selectEntry(selectedPath === node.id ? null : node.id);
        return;
      }
    }
  };

  if (isLoading) {
    return (
      <Flex align="center" justify="center" className="h-full">
        <Text className="text-[13px] text-gray-10">Building graph...</Text>
      </Flex>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <Flex
        align="center"
        justify="center"
        direction="column"
        gap="2"
        className="h-full"
      >
        <Text className="text-[13px] text-gray-10">
          No entries to graph yet
        </Text>
        <Text className="text-[12px] text-gray-9">
          Add markdown links between entries to see connections.
        </Text>
      </Flex>
    );
  }

  return (
    <Box ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        width={size.w}
        height={size.h}
        onClick={handleCanvasClick}
        className="cursor-pointer"
      />
      <GraphLegend />
    </Box>
  );
}

function GraphLegend() {
  const types = Object.entries(TYPE_COLORS).slice(0, 5);
  return (
    <Flex
      gap="3"
      className="absolute bottom-3 left-3 rounded border border-gray-5 bg-gray-1/90 px-2 py-1.5 backdrop-blur-sm"
    >
      {types.map(([type, color]) => (
        <Flex key={type} align="center" gap="1">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <Text className="text-[11px] text-gray-10">{type}</Text>
        </Flex>
      ))}
    </Flex>
  );
}
