"use client";

import { useEffect, useRef, useState } from "react";
import { createLayoutDebugStorageKey, diffLayoutSnapshots, stringifyLayoutDebugSnapshot, type LayoutDebugSnapshot } from "@/lib/layoutDebug";

export function TemplatePreviewFrame({
  html,
  title,
  width,
  height,
  templateId,
  layoutDebug = false,
}: {
  html: string;
  title: string;
  width: number;
  height: number;
  templateId: string;
  layoutDebug?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [builderSnapshot, setBuilderSnapshot] = useState<LayoutDebugSnapshot | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<LayoutDebugSnapshot | null>(null);
  const [iframeLoadVersion, setIframeLoadVersion] = useState(0);

  useEffect(() => {
    if (!layoutDebug) return;

    const storageKey = createLayoutDebugStorageKey(templateId);
    let channel: BroadcastChannel | null = null;

    function loadBuilderSnapshot() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          setBuilderSnapshot(JSON.parse(raw) as LayoutDebugSnapshot);
          return;
        }
      } catch {
        // fallback below
      }

      try {
        const openerSnapshot = (window.opener as Window & { __builderLayoutDebugSnapshot?: LayoutDebugSnapshot } | null)?.__builderLayoutDebugSnapshot;
        if (openerSnapshot) {
          setBuilderSnapshot(openerSnapshot);
          localStorage.setItem(storageKey, stringifyLayoutDebugSnapshot(openerSnapshot));
          return;
        }
      } catch {
        // ignore opener access issues
      }

      setBuilderSnapshot(null);
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const payload = event.data as { type?: string; snapshot?: LayoutDebugSnapshot } | null;
      if (payload?.type !== "template-layout-debug" || !payload.snapshot) return;
      setPreviewSnapshot(payload.snapshot);
    }

    function onStorage(event: StorageEvent) {
      if (event.key === storageKey) loadBuilderSnapshot();
    }

    function onVisibilityChange() {
      if (!document.hidden) loadBuilderSnapshot();
    }

    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("toolbox-layout-debug");
      channel.addEventListener("message", (event) => {
        const payload = event.data as { templateId?: string; snapshot?: LayoutDebugSnapshot } | null;
        if (payload?.templateId !== templateId || !payload.snapshot) return;
        setBuilderSnapshot(payload.snapshot);
        localStorage.setItem(storageKey, stringifyLayoutDebugSnapshot(payload.snapshot));
      });
    }

    loadBuilderSnapshot();
    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      channel?.close();
    };
  }, [layoutDebug, templateId]);

  useEffect(() => {
    if (!layoutDebug) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 60;

    const interval = window.setInterval(() => {
      if (cancelled) return;
      attempts += 1;

      try {
        const iframeWindow = iframeRef.current?.contentWindow as (Window & {
          __layoutDebugSnapshot?: LayoutDebugSnapshot | null;
          __templateReady?: boolean;
        }) | null;
        const snapshot = iframeWindow?.__layoutDebugSnapshot;
        if (snapshot) {
          setPreviewSnapshot(snapshot);
          window.clearInterval(interval);
          return;
        }

        if (iframeWindow?.__templateReady === true && attempts >= 5) {
          window.clearInterval(interval);
        }
      } catch {
        if (attempts >= maxAttempts) {
          window.clearInterval(interval);
        }
      }

      if (attempts >= maxAttempts) {
        window.clearInterval(interval);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [iframeLoadVersion, layoutDebug]);

  const blockDiffs = diffLayoutSnapshots(builderSnapshot, previewSnapshot);

  async function copySnapshot(snapshot: LayoutDebugSnapshot | null) {
    if (!snapshot) return;
    await navigator.clipboard.writeText(stringifyLayoutDebugSnapshot(snapshot));
  }

  useEffect(() => {
    function updateScale() {
      const container = containerRef.current;
      if (!container) return;

      const styles = window.getComputedStyle(container);
      const horizontalPadding = Number.parseFloat(styles.paddingLeft || "0") + Number.parseFloat(styles.paddingRight || "0");
      const verticalPadding = Number.parseFloat(styles.paddingTop || "0") + Number.parseFloat(styles.paddingBottom || "0");
      const availableWidth = Math.max(0, container.clientWidth - horizontalPadding);
      const availableHeight = Math.max(0, container.clientHeight - verticalPadding);
      const nextScale = Math.min(availableWidth / width, availableHeight / height, 1);
      setScale(Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1);
    }

    updateScale();

    const observer = new ResizeObserver(() => updateScale());
    if (containerRef.current) observer.observe(containerRef.current);
    window.addEventListener("resize", updateScale);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [height, width]);

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-950">
      <div ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 md:p-6">
        <div className="flex h-full w-full items-center justify-center">
          <div
            className="shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white shadow-2xl"
            style={{ width: width * scale, height: height * scale }}
          >
            <iframe
              ref={iframeRef}
              title={`Preview ${title}`}
              srcDoc={html}
              onLoad={() => {
                setPreviewSnapshot(null);
                setIframeLoadVersion((current) => current + 1);
              }}
              className="block border-0 bg-white"
              style={{
                width,
                height,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        </div>
      </div>

      {layoutDebug ? (
        <div className="max-h-[42vh] shrink-0 overflow-auto border-t border-white/10 bg-neutral-950/95">
          <div className="mx-auto w-full max-w-6xl px-4 py-4">
            <div className="rounded-xl border border-amber-400/30 bg-neutral-950/90 text-white shadow-2xl">
              <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3 text-xs">
                <span className="rounded-full bg-amber-400/15 px-2 py-1 font-medium text-amber-200">Mode debug layout</span>
                <span className="text-white/45">Builder: {builderSnapshot ? `${builderSnapshot.blocks.length} blocs` : "indisponible"}</span>
                <span className="text-white/45">Rendu: {previewSnapshot ? `${previewSnapshot.blocks.length} blocs` : "en attente"}</span>
                <span className="text-white/45">Max delta: {blockDiffs[0]?.maxAbsDelta ?? 0}px</span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void copySnapshot(builderSnapshot)}
                    className="rounded-md border border-white/10 px-2 py-1 text-white/80 hover:bg-white/10"
                  >
                    Copier builder
                  </button>
                  <button
                    type="button"
                    onClick={() => void copySnapshot(previewSnapshot)}
                    className="rounded-md border border-white/10 px-2 py-1 text-white/80 hover:bg-white/10"
                  >
                    Copier rendu
                  </button>
                </div>
              </div>

              <div className="grid gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr]">
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Plus gros écarts</p>
                  <div className="mt-3 space-y-2 text-[11px]">
                    {blockDiffs.length === 0 ? (
                      <p className="text-white/60">Aucun diff disponible pour l’instant.</p>
                    ) : blockDiffs.slice(0, 12).map((diff) => (
                      <div key={diff.blockId} className="rounded-md border border-white/10 bg-black/20 p-2">
                        <p className="font-medium text-white">{diff.blockId}</p>
                        <p className="text-white/50">Groupe {diff.groupId}</p>
                        <p className="mt-1 text-white/75">left {diff.deltaLeft}px, top {diff.deltaTop}px, visibleW {diff.deltaVisibleWidth}px, visibleH {diff.deltaVisibleHeight}px</p>
                        <p className="text-white/55">frameW {diff.deltaFrameWidth}px, frameH {diff.deltaFrameHeight}px, boxX {diff.deltaBoxOffsetX}px, boxY {diff.deltaBoxOffsetY}px</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Snapshot builder</p>
                  <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/25 p-3 text-[10px] leading-4 text-white/80">
                    {stringifyLayoutDebugSnapshot(builderSnapshot)}
                  </pre>
                </div>

                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Snapshot rendu</p>
                  <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/25 p-3 text-[10px] leading-4 text-white/80">
                    {stringifyLayoutDebugSnapshot(previewSnapshot)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}