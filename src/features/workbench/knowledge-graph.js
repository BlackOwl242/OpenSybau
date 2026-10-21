import { view } from "../../shared/state.js";

let neuralGraphCleanup = null;
let mountedGraphCanvas = null;
let mountedGraphData = null;

export function mountKnowledgeGraphCanvas({ loadVaultPreview } = {}) {
  const currentCanvas = view.page === "knowledge" && view.vaultViewMode === "graph" ? document.getElementById("vault-neural-canvas") : null;
  if (currentCanvas && currentCanvas === mountedGraphCanvas && view.vaultGraph === mountedGraphData) return;
  if (neuralGraphCleanup) { neuralGraphCleanup(); neuralGraphCleanup = null; }
  mountedGraphCanvas = null;
  mountedGraphData = null;
  if (view.page !== "knowledge" || view.vaultViewMode !== "graph") return;
  const canvas = document.getElementById("vault-neural-canvas");
  if (!canvas) return;
  const graph = view.vaultGraph || { nodes: [], edges: [] };
  if (!graph.nodes?.length) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  mountedGraphCanvas = canvas;
  mountedGraphData = view.vaultGraph;

  view.vaultGraphPositions ||= new Map();
  const simNodes = graph.nodes.map((n, i) => {
    const saved = view.vaultGraphPositions.get(n.id);
    const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
    const radius = 65 + (i % 3) * 35;
    return {
      ...n,
      x: saved ? saved.x : Math.cos(angle) * radius,
      y: saved ? saved.y : Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      radius: Math.min(9.5, 4.5 + Math.sqrt(n.degree || 0) * 1.6),
    };
  });
  const nodeById = new Map(simNodes.map((n) => [n.id, n]));
  const simEdges = (graph.edges || []).map((e) => ({
    ...e,
    sourceNode: nodeById.get(e.source),
    targetNode: nodeById.get(e.target),
  })).filter((e) => e.sourceNode && e.targetNode);

  let camX = 0;
  let camY = 0;
  let camZoom = 1;
  let hoveredNode = null;
  let draggedNode = null;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let pointerMoved = false;
  let pulsePhase = 0;
  let rafId = 0;
  let cooling = 1.0;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const screenToWorld = (sx, sy) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (sx - rect.width / 2 - camX) / camZoom,
      y: (sy - rect.height / 2 - camY) / camZoom,
    };
  };

  const findNodeAt = (sx, sy) => {
    const { x, y } = screenToWorld(sx, sy);
    for (let i = simNodes.length - 1; i >= 0; i -= 1) {
      const n = simNodes[i];
      const hitRadius = (n.radius + 6) / Math.max(0.5, camZoom);
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) return n;
    }
    return null;
  };

  const stepPhysics = () => {
    if (cooling < 0.01 && !draggedNode) return;
    const count = simNodes.length;
    for (let i = 0; i < count; i += 1) {
      const a = simNodes[i];
      a.vx -= a.x * 0.01 * cooling;
      a.vy -= a.y * 0.01 * cooling;
      for (let j = i + 1; j < count; j += 1) {
        const b = simNodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) { dx = (Math.random() - 0.5) * 2; dy = (Math.random() - 0.5) * 2; distSq = dx * dx + dy * dy; }
        const dist = Math.sqrt(distSq);
        const repulse = (1300 / (distSq + 100)) * cooling;
        const fx = (dx / dist) * repulse;
        const fy = (dy / dist) * repulse;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    for (const edge of simEdges) {
      const a = edge.sourceNode;
      const b = edge.targetNode;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ideal = edge.kind === "link" ? 88 : edge.kind === "tag" ? 110 : 130;
      const strength = edge.kind === "link" ? 0.05 : edge.kind === "tag" ? 0.03 : 0.016;
      const force = (dist - ideal) * strength * cooling;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    for (const n of simNodes) {
      if (n === draggedNode) { n.vx = 0; n.vy = 0; continue; }
      n.vx *= 0.82;
      n.vy *= 0.82;
      n.x += Math.max(-10, Math.min(10, n.vx));
      n.y += Math.max(-10, Math.min(10, n.vy));
      view.vaultGraphPositions.set(n.id, { x: n.x, y: n.y });
    }
    if (!draggedNode) cooling *= 0.985;
  };

  const draw = () => {
    stepPhysics();
    pulsePhase = (pulsePhase + 0.006) % 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const selectedId = view.vaultPreview?.path || "";
    const activeId = hoveredNode?.id || selectedId;
    const neighborIds = new Set();
    if (activeId) {
      neighborIds.add(activeId);
      for (const e of simEdges) {
        if (e.source === activeId) neighborIds.add(e.target);
        if (e.target === activeId) neighborIds.add(e.source);
      }
    }

    const lightScheme = document.documentElement?.dataset?.colorScheme === "light";
    ctx.save();
    ctx.translate(w / 2 + camX, h / 2 + camY);
    ctx.scale(camZoom, camZoom);

    for (let idx = 0; idx < simEdges.length; idx += 1) {
      const e = simEdges[idx];
      const a = e.sourceNode;
      const b = e.targetNode;
      const isHighlighted = activeId && (e.source === activeId || e.target === activeId);
      const isDimmed = activeId && !isHighlighted;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (isHighlighted) {
        ctx.strokeStyle = lightScheme ? "rgba(15, 23, 42, 0.52)" : "rgba(255, 255, 255, 0.58)";
        ctx.lineWidth = 1.35;
      } else {
        ctx.strokeStyle = isDimmed
          ? (lightScheme ? "rgba(15, 23, 42, 0.05)" : "rgba(255, 255, 255, 0.04)")
          : (lightScheme ? "rgba(15, 23, 42, 0.16)" : "rgba(255, 255, 255, 0.14)");
        ctx.lineWidth = 1;
      }
      ctx.stroke();

      if (isHighlighted || (!activeId && e.kind === "link")) {
        const t = (pulsePhase + (idx * 0.23)) % 1;
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        ctx.beginPath();
        ctx.arc(px, py, isHighlighted ? 1.75 : 1.3, 0, Math.PI * 2);
        ctx.fillStyle = isHighlighted
          ? (lightScheme ? "#0f172a" : "#ffffff")
          : (lightScheme ? "rgba(15, 23, 42, 0.42)" : "rgba(255, 255, 255, 0.42)");
        ctx.fill();
      }
    }

    for (const n of simNodes) {
      const isSelected = n.id === selectedId;
      const isHovered = n === hoveredNode;
      const isNeighbor = neighborIds.has(n.id);
      const isDimmed = activeId && !isNeighbor;

      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = lightScheme ? "rgba(15, 23, 42, 0.24)" : "rgba(255, 255, 255, 0.22)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      if (isSelected || isHovered) {
        ctx.fillStyle = lightScheme ? "#0f172a" : "#ffffff";
        ctx.strokeStyle = lightScheme ? "#ffffff" : "#09090b";
        ctx.lineWidth = 1.5;
      } else if (isDimmed) {
        ctx.fillStyle = lightScheme ? "rgba(148, 163, 184, 0.28)" : "rgba(113, 113, 122, 0.24)";
        ctx.strokeStyle = lightScheme ? "rgba(15, 23, 42, 0.08)" : "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 1;
      } else {
        ctx.fillStyle = lightScheme
          ? (n.degree > 1 ? "#334155" : "#64748b")
          : (n.degree > 1 ? "#d4d4d8" : "#71717a");
        ctx.strokeStyle = lightScheme ? "rgba(255, 255, 255, 0.9)" : "rgba(18, 19, 23, 0.9)";
        ctx.lineWidth = 1.25;
      }
      ctx.fill();
      ctx.stroke();

      if (!isDimmed || camZoom > 1.25) {
        ctx.font = `${isSelected || isHovered ? "600" : "500"} 11px "Nunito Sans Variable", "Segoe UI", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isSelected || isHovered
          ? (lightScheme ? "#0f172a" : "#ffffff")
          : isDimmed
            ? (lightScheme ? "rgba(15, 23, 42, 0.24)" : "rgba(255, 255, 255, 0.2)")
            : (lightScheme ? "rgba(15, 23, 42, 0.82)" : "rgba(228, 228, 231, 0.78)");
        ctx.fillText(n.stem || n.name, n.x, n.y + n.radius + 5);
      }
    }

    ctx.restore();
    rafId = requestAnimationFrame(draw);
  };

  const onPointerDown = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    pointerMoved = false;
    const hit = findNodeAt(sx, sy);
    if (hit) {
      draggedNode = hit;
      cooling = Math.max(cooling, 0.35);
    } else {
      isPanning = true;
      panStartX = e.clientX - camX;
      panStartY = e.clientY - camY;
    }
  };

  const onPointerMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (draggedNode) {
      pointerMoved = true;
      const world = screenToWorld(sx, sy);
      draggedNode.x = world.x;
      draggedNode.y = world.y;
      view.vaultGraphPositions.set(draggedNode.id, { x: world.x, y: world.y });
      cooling = Math.max(cooling, 0.25);
      canvas.style.cursor = "grabbing";
      return;
    }
    if (isPanning) {
      pointerMoved = true;
      camX = e.clientX - panStartX;
      camY = e.clientY - panStartY;
      canvas.style.cursor = "grabbing";
      return;
    }
    hoveredNode = findNodeAt(sx, sy);
    canvas.style.cursor = hoveredNode ? "pointer" : "grab";
  };

  const onPointerUp = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (draggedNode && !pointerMoved) {
      const targetPath = draggedNode.path;
      draggedNode = null;
      if (loadVaultPreview) void loadVaultPreview(targetPath);
      return;
    }
    draggedNode = null;
    isPanning = false;
    hoveredNode = findNodeAt(sx, sy);
    canvas.style.cursor = hoveredNode ? "pointer" : "grab";
  };

  const onDblClick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const hit = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      view.vaultViewMode = "files";
      if (loadVaultPreview) void loadVaultPreview(hit.path);
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    camZoom = Math.max(0.35, Math.min(2.8, camZoom * factor));
  };

  const onReset = () => {
    camX = 0; camY = 0; camZoom = 1; cooling = 0.8;
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("dblclick", onDblClick);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.dataset.resetReady = "1";
  canvas._resetCamera = onReset;

  rafId = requestAnimationFrame(draw);
  neuralGraphCleanup = () => {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("dblclick", onDblClick);
    canvas.removeEventListener("wheel", onWheel);
  };
}
