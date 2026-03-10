"use client";

import { useRef, useState, useCallback } from "react";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { AnyBlock } from "@/types/template";
import { Resizable } from "re-resizable";

const GRID_SIZE = 10; // canvas units

export function Canvas() {
  const { template, selectedBlockId, selectBlock, updateBlock, updateBlocks } = useBuilderStore();
  const { canvas, blocks } = template;
  const [zoom, setZoom] = useState(0.5);
  const [showGrid, setShowGrid] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);
  // Multi-select: set of block ids (Ctrl+click to toggle)
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const canvasRef = useRef<HTMLDivElement>(null);

  /** Snap a value to the nearest GRID_SIZE increment if snap is on */
  const snap = useCallback((v: number) =>
    snapToGrid ? Math.round(v / GRID_SIZE) * GRID_SIZE : Math.round(v),
    [snapToGrid]
  );

  // Dragging state — also stores original positions of all multi-selected blocks
  const dragging = useRef<{
    id: string;
    startX: number;
    startY: number;
    origPositions: Record<string, { x: number; y: number }>;
  } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, block: AnyBlock) => {
      e.stopPropagation();

      // Locked blocks: allow selection but no drag
      if (block.locked) {
        selectBlock(block.id);
        return;
      }

      // --- Multi-select logic ---
      if (e.ctrlKey || e.metaKey) {
        // Toggle this block in multi-selection; keep last clicked as primary
        setMultiSelected((prev) => {
          const next = new Set(prev);
          if (next.has(block.id)) {
            next.delete(block.id);
            selectBlock(next.size > 0 ? [...next][next.size - 1] : null);
          } else {
            next.add(block.id);
            selectBlock(block.id);
          }
          return next;
        });
        return; // don't start drag on ctrl+click
      }

      // Regular click: if not already in multi-select, clear multi-select
      if (!multiSelected.has(block.id)) {
        setMultiSelected(new Set([block.id]));
      }
      selectBlock(block.id);

      // Capture original positions for all selected blocks (or just this one)
      const ids = multiSelected.has(block.id) ? [...multiSelected] : [block.id];
      const origPositions: Record<string, { x: number; y: number }> = {};
      for (const id of ids) {
        const b = blocks.find((bl) => bl.id === id);
        if (b) origPositions[id] = { x: b.x, y: b.y };
      }
      // Always include dragged block
      origPositions[block.id] = { x: block.x, y: block.y };

      dragging.current = {
        id: block.id,
        startX: e.clientX,
        startY: e.clientY,
        origPositions,
      };

      function onMove(ev: MouseEvent) {
        if (!dragging.current) return;
        const rawDx = (ev.clientX - dragging.current.startX) / zoom;
        const rawDy = (ev.clientY - dragging.current.startY) / zoom;

        const updates = Object.entries(dragging.current.origPositions).map(([id, orig]) => ({
          id,
          changes: {
            x: snap(orig.x + rawDx),
            y: snap(orig.y + rawDy),
          } as Partial<AnyBlock>,
        }));

        if (updates.length === 1) {
          updateBlock(updates[0].id, updates[0].changes);
        } else {
          updateBlocks(updates);
        }
      }

      function onUp() {
        dragging.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [zoom, snap, blocks, multiSelected, selectBlock, updateBlock, updateBlocks]
  );

  const zoomIn  = () => setZoom((z) => Math.min(1, z + 0.1));
  const zoomOut = () => setZoom((z) => Math.max(0.15, z - 0.1));
  const fitToScreen = () => setZoom(0.5);

  // Sort blocks by z
  const sorted = [...blocks].sort((a, b) => a.z - b.z);

  // Grid CSS background (scales with zoom)
  const gridStyle: React.CSSProperties = showGrid ? {
    backgroundImage:
      `linear-gradient(rgba(99,102,241,0.12) 1px, transparent 1px),` +
      `linear-gradient(90deg, rgba(99,102,241,0.12) 1px, transparent 1px)`,
    backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
  } : {};

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-200">
      {/* Zoom + options toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 border-b border-gray-200 shrink-0 flex-wrap">
        <button onClick={zoomOut} className="text-xs px-2 py-0.5 bg-white border rounded hover:bg-gray-50">−</button>
        <span className="text-xs text-gray-600 w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={zoomIn}  className="text-xs px-2 py-0.5 bg-white border rounded hover:bg-gray-50">+</button>
        <button onClick={fitToScreen} className="text-xs px-2 py-0.5 bg-white border rounded hover:bg-gray-50">Fit</button>

        <span className="text-gray-300 mx-1">|</span>

        {/* Grid toggle */}
        <button
          onClick={() => setShowGrid((v) => !v)}
          title="Afficher/masquer la grille"
          className={`text-xs px-2 py-0.5 border rounded transition-colors ${
            showGrid ? "bg-indigo-100 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
        >
          ⊞ Grille
        </button>

        {/* Snap toggle */}
        <button
          onClick={() => setSnapToGrid((v) => !v)}
          title="Snap to grid (10px)"
          className={`text-xs px-2 py-0.5 border rounded transition-colors ${
            snapToGrid ? "bg-indigo-100 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
        >
          🧲 Snap
        </button>

        {/* Multi-select hint */}
        {multiSelected.size > 1 && (
          <span className="text-xs text-indigo-600 ml-2">{multiSelected.size} blocs sélectionnés</span>
        )}
      </div>

      {/* Scrollable canvas area — outer handles scroll, inner handles centering */}
      <div
        className="flex-1 overflow-auto"
        onClick={() => { selectBlock(null); setMultiSelected(new Set()); }}
      >
        <div className="flex items-start justify-center p-8 min-w-fit min-h-full">
        <div
          ref={canvasRef}
          style={{
            width: canvas.width * zoom,
            height: canvas.height * zoom,
            position: "relative",
            backgroundColor: canvas.backgroundColor,
            boxShadow: "0 4px 32px rgba(0,0,0,0.15)",
            overflow: "hidden",
            flexShrink: 0,
            ...gridStyle,
          }}
        >
          {sorted.map((block) => {
            const isPrimary = selectedBlockId === block.id;
            const isMulti = multiSelected.has(block.id);
            const outlineColor = isPrimary ? "#F59E0B" : isMulti ? "#818CF8" : "transparent";
            return (
              <Resizable
                key={block.id}
                size={{ width: block.w * zoom, height: block.h * zoom }}
                minWidth={20 * zoom}
                minHeight={20 * zoom}
                onResizeStop={(_e, _dir, _ref, d) => {
                  updateBlock(block.id, {
                    w: snap(block.w + d.width / zoom),
                    h: snap(block.h + d.height / zoom),
                  });
                }}
                enable={{
                  top: isPrimary && !block.locked, right: isPrimary && !block.locked,
                  bottom: isPrimary && !block.locked, left: isPrimary && !block.locked,
                  topRight: isPrimary && !block.locked, bottomRight: isPrimary && !block.locked,
                  bottomLeft: isPrimary && !block.locked, topLeft: isPrimary && !block.locked,
                }}
                style={{
                  position: "absolute",
                  left: block.x * zoom,
                  top: block.y * zoom,
                  zIndex: block.z,
                  cursor: block.locked ? "default" : "move",
                  outline: `2px solid ${outlineColor}`,
                  outlineOffset: "1px",
                  transform: block.rotation ? `rotate(${block.rotation}deg)` : undefined,
                  transformOrigin: "center center",
                }}
              >
                <BlockPreview
                  block={block}
                  zoom={zoom}
                  onMouseDown={(e) => handleMouseDown(e, block)}
                />
                {block.locked && (
                  <div style={{
                    position: "absolute", top: 2, right: 2,
                    background: "rgba(0,0,0,0.45)", borderRadius: 3,
                    padding: "1px 3px", fontSize: 9, color: "#fff",
                    pointerEvents: "none", lineHeight: 1.2,
                  }}>🔒</div>
                )}
              </Resizable>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}

// ─── DPE preview SVG helpers (client-side, no Node.js deps) ─────────────────
const DPE_LETTERS = ["A","B","C","D","E","F","G"] as const;
const DPE_E_FILL  = ["#009944","#52B848","#AEC931","#FFF200","#F7A800","#E2521C","#CC1719"];
const DPE_E_TEXT  = ["#fff","#fff","#1A1A1A","#1A1A1A","#1A1A1A","#fff","#fff"];
const DPE_C_FILL  = ["#C8E0F0","#87BEDF","#6898C0","#4F7898","#3D5D7C","#2B4360","#1B2C3C"];
const DPE_C_TEXT  = ["#1A1A1A","#1A1A1A","#fff","#fff","#fff","#fff","#fff"];

function buildDpePreviewSvg(variant: string): string {
  // ── Climat (aperçu B actif, viewBox 540×360 = même ratio que énergie) ──────────
  if (variant === "climate") {
    const ai=1, sX=4, bW=[93,125,157,186,217,248,277], sH=43, nH=31, aH=43, armX=280;
    let bars="";
    for(let i=0;i<7;i++){
      const act=i===ai,sY=24+i*sH,h=act?aH:nH,yT=sY+(sH-h)/2,yM=yT+h/2,yB=yT+h;
      const eX=sX+bW[i],r=h/2;
      bars+=`<path d="M ${sX},${yT} L ${eX},${yT} A ${r},${r},0,0,1,${eX},${yB} L ${sX},${yB} Z" fill="${DPE_C_FILL[i]}"${act?` stroke="black" stroke-width="3"`:""}/>`;
      bars+=`<text x="${sX+12}" y="${yM}" font-family="Arial" font-size="${act?26:11}" font-weight="${act?700:600}" fill="${DPE_C_TEXT[i]}" dominant-baseline="central">${DPE_LETTERS[i]}</text>`;
      if(act) bars+=`<line x1="${eX+r}" y1="${yM}" x2="${armX}" y2="${yM}" stroke="${DPE_C_FILL[i]}" stroke-width="1.5"/>`;
    }
    const armY=24+ai*sH+sH/2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 365 360" style="width:100%;height:100%;display:block;"><text x="4" y="16" font-family="Arial" font-size="11" font-weight="600" fill="#6AADCE">Peu d'\u00e9missions de CO&#x2082;</text>${bars}<text x="${armX+5}" y="${armY-5}" font-family="Arial" font-size="9" font-weight="600" fill="#1A1A1A">12 kg CO&#x2082;</text><text x="${armX+5}" y="${armY+7}" font-family="Arial" font-size="8" fill="#555">m&#xB2;/an</text><text x="4" y="354" font-family="Arial" font-size="10.5" font-weight="700" fill="#1A1A1A">\u00c9missions de CO&#x2082; tr\u00e8s importantes</text></svg>`;
  }
  // ── Énergie (aperçu C actif, viewBox 540×360) ─────────────────────────────
  const ai=2, bsX=140, bW=[112,146,180,214,248,282,316], sH=42, nH=32, aH=42, aN=18, aA=30;
  const boxH=56, rawCY=24+ai*sH+sH/2, bTop=Math.min(Math.max(Math.round(rawCY-boxH/2),17),360-34-boxH);
  const fT=24+5*sH, gB=24+7*sH, pMid=Math.round((fT+gB)/2), brkX=490;
  let bars="";
  for(let i=0;i<7;i++){
    const act=i===ai,sY=24+i*sH,h=act?aH:nH,yB=sY+(sH-h)/2,eX=bsX+bW[i],tX=eX+(act?aA:aN),yM=yB+h/2;
    bars+=`<polygon points="${bsX},${yB} ${eX},${yB} ${tX},${yM} ${eX},${yB+h} ${bsX},${yB+h}" fill="${DPE_E_FILL[i]}"${act?` stroke="black" stroke-width="3" stroke-linejoin="round"`:""}/>`;
    bars+=`<text x="${bsX+14}" y="${yM}" font-family="Arial" font-size="${act?26:11}" font-weight="${act?700:600}" fill="${DPE_E_TEXT[i]}" dominant-baseline="central">${DPE_LETTERS[i]}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 360" style="width:100%;height:100%;display:block;"><text x="${bsX}" y="16" text-anchor="start" font-family="Arial" font-size="12" font-weight="700" fill="#009944">Logement très performant</text><rect x="2" y="${bTop}" width="66" height="${boxH}" fill="white" stroke="#bbb" stroke-width="0.8"/><text x="35" y="${bTop+10}" text-anchor="middle" font-family="Arial" font-size="5.5" fill="#444">consommation</text><text x="35" y="${bTop+39}" text-anchor="middle" font-family="Arial" font-size="16" font-weight="700" fill="#1A1A1A">180</text><text x="35" y="${bTop+52}" text-anchor="middle" font-family="Arial" font-size="6" fill="#555">kWh/m²/an</text><rect x="72" y="${bTop}" width="62" height="${boxH}" fill="white" stroke="#bbb" stroke-width="0.8"/><text x="103" y="${bTop+10}" text-anchor="middle" font-family="Arial" font-size="5.5" fill="#444">émissions</text><text x="103" y="${bTop+35}" text-anchor="middle" font-family="Arial" font-size="16" font-weight="700" fill="#1A1A1A">12</text><text x="103" y="${bTop+48}" text-anchor="middle" font-family="Arial" font-size="6" fill="#555">kg CO₂/m²/an</text><line x1="${brkX}" y1="${fT+2}" x2="${brkX}" y2="${gB-2}" stroke="#aaa" stroke-width="0.8"/><line x1="${brkX-6}" y1="${fT+2}" x2="${brkX}" y2="${fT+2}" stroke="#aaa" stroke-width="0.8"/><line x1="${brkX-6}" y1="${gB-2}" x2="${brkX}" y2="${gB-2}" stroke="#aaa" stroke-width="0.8"/><text x="${brkX+4}" y="${pMid-5}" font-family="Arial" font-size="5.5" fill="#888" font-style="italic">passoire</text><text x="${brkX+4}" y="${pMid+6}" font-family="Arial" font-size="5.5" fill="#888" font-style="italic">énergétique</text>${bars}<text x="${bsX}" y="352" text-anchor="start" font-family="Arial" font-size="12" font-weight="700" fill="#CC1719">Logement extrêmement peu performant</text></svg>`;
}

function BlockPreview({
  block,
  zoom,
  onMouseDown,
}: {
  block: AnyBlock;
  zoom: number;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    userSelect: "none",
    fontSize: zoom * 12,
  };

  let content: React.ReactNode;

  switch (block.type) {
    case "text": {
      const vAlign = block.style.verticalAlign ?? "top";
      const justifyContent =
        vAlign === "middle" ? "center" : vAlign === "bottom" ? "flex-end" : "flex-start";
      content = (
        <div
          style={{
            ...style,
            display: "flex",
            flexDirection: "column",
            justifyContent,
            backgroundColor: block.style.backgroundColor,
          }}
        >
          <div
            style={{
              fontFamily: block.style.fontFamily,
              fontSize: (block.style.fontSize ?? 14) * (4 / 3) * zoom,
              fontWeight: block.style.fontWeight,
              color: block.style.color,
              padding: (block.style.padding ?? 0) * zoom,
              textAlign: block.style.textAlign,
              display: "-webkit-box",
              WebkitLineClamp: block.rules.maxLines ?? undefined,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {block.content !== undefined
              ? block.content || <span style={{ opacity: 0.35 }}>Texte…</span>
              : block.binding
                ? `{{${block.binding}}}`
                : block.staticText || <span style={{ opacity: 0.35 }}>Texte…</span>}
          </div>
        </div>
      );
      break;
    }

    case "video":
      content = (
        <div
          style={{
            ...style,
            background: (block as import("@/types/template").VideoBlock).placeholderColor ?? "#111827",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24 * zoom,
            color: "rgba(255,255,255,0.6)",
            flexDirection: "column",
            gap: 4 * zoom,
          }}
        >
          <span>🎥</span>
          {block.binding && <span style={{ fontSize: 10 * zoom, opacity: 0.7 }}>{block.binding}</span>}
        </div>
      );
      break;

    case "image":
      content = block.staticSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.staticSrc}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: block.fit ?? "cover",
            display: "block",
            pointerEvents: "none",
          }}
        />
      ) : (
        <div
          style={{
            ...style,
            background: "#E5E7EB",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24 * zoom,
            color: "#9CA3AF",
          }}
        >
          {block.binding ? `🖼 ${block.binding}` : "🖼"}
        </div>
      );
      break;

    case "dpe":
      content = (
        <div
          style={{ ...style, overflow: "hidden" }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: buildDpePreviewSvg(block.variant) }}
        />
      );
      break;

    case "shape": {
      const CLIP: Record<string, string> = {
        rectangle: "",
        circle:    "",
        triangle:  "polygon(50% 0%, 0% 100%, 100% 100%)",
        diamond:   "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
      };
      const clip = CLIP[block.shape] ?? "";
      const br = block.shape === "circle" ? "50%" : `${(block.borderRadius ?? 0) * zoom}px`;
      content = (
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: block.fillColor,
            borderRadius: br,
            border: block.borderWidth ? `${block.borderWidth * zoom}px solid ${block.borderColor ?? "transparent"}` : undefined,
            boxSizing: "border-box",
            clipPath: clip || undefined,
            opacity: block.opacity ?? 1,
          }}
        />
      );
      break;
    }
  }

  return (
    <div onMouseDown={onMouseDown} onClick={(e) => e.stopPropagation()} style={{ width: "100%", height: "100%" }}>
      {content}
    </div>
  );
}
