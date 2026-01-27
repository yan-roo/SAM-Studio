"use client";

import { useEffect, useRef, useState } from "react";

type ABPlayerProps = {
  onRender?: () => void;
  onRenderPreview?: () => void;
  disabled?: boolean;
  previewDisabled?: boolean;
  previewSeconds?: number;
  previewOptions?: number[];
  onPreviewSecondsChange?: (seconds: number) => void;
  onPreviewReset?: () => void;
  previewStartSeconds?: number;
  onPreviewStartChange?: (seconds: number) => void;
  outputUrl?: string | null;
  inputUrl?: string | null;
  fullInputUrl?: string | null;
  status?: "idle" | "rendering" | "ready" | "error" | "cancelled";
  error?: string | null;
  outputKind?: "preview" | "full" | null;
  outputPreviewSeconds?: number | null;
  renderMode?: "preview" | "full" | null;
  renderElapsedSeconds?: number | null;
  renderProgress?: number | null;
  renderChunksDone?: number | null;
  renderChunksTotal?: number | null;
  renderEtaSeconds?: number | null;
  onCancel?: () => void;
  onRestart?: () => void;
};

export function ABPlayer({
  onRender,
  onRenderPreview,
  disabled,
  previewDisabled,
  previewSeconds,
  previewOptions,
  onPreviewSecondsChange,
  onPreviewReset,
  previewStartSeconds,
  onPreviewStartChange,
  outputUrl,
  inputUrl,
  fullInputUrl,
  status,
  error,
  outputKind,
  outputPreviewSeconds,
  renderMode,
  renderElapsedSeconds,
  renderProgress,
  renderChunksDone,
  renderChunksTotal,
  renderEtaSeconds,
  onCancel,
  onRestart,
}: ABPlayerProps) {
  const [activeSide, setActiveSide] = useState<"original" | "processed">("original");
  const originalRef = useRef<HTMLAudioElement | null>(null);
  const processedRef = useRef<HTMLAudioElement | null>(null);
  const options = previewOptions?.length ? previewOptions : [5, 10, 20, 30, -1];
  const isCustom =
    previewSeconds !== undefined && previewSeconds > 0 && !options.includes(previewSeconds);
  const showCustom = Boolean(isCustom);
  const selectValue = showCustom ? -1 : previewSeconds ?? 10;
  const renderingLabel = renderMode === "preview" ? "Rendering preview..." : "Rendering mix...";
  const readyLabel = outputKind === "preview" ? "Preview ready" : "Mix ready";
  const statusLabel =
    status === "rendering"
      ? renderingLabel
      : status === "ready"
        ? readyLabel
        : status === "cancelled"
          ? "Cancelled"
        : status === "error"
          ? "Mix failed"
          : "Awaiting mix";
  const formatDuration = (value: number) => {
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };
  const elapsedLabel =
    status === "rendering" && renderElapsedSeconds != null
      ? `Elapsed ${formatDuration(renderElapsedSeconds)}`
      : null;
  const progressLabel =
    status === "rendering" &&
    renderChunksDone != null &&
    renderChunksTotal != null &&
    renderChunksTotal > 0
      ? `${renderChunksDone}/${renderChunksTotal}`
      : null;
  const etaLabel =
    status === "rendering" && renderEtaSeconds != null
      ? `ETA ${formatDuration(Math.ceil(renderEtaSeconds))}`
      : null;
  const percentLabel =
    status === "rendering" && renderProgress != null
      ? `${Math.round(renderProgress * 100)}%`
      : null;
  const metaCopy =
    error ??
    (status === "rendering"
      ? "Rendering can take a few minutes on CPU. You can cancel or restart if needed."
      : status === "cancelled"
        ? "Mix cancelled. Adjust prompts and render again when ready."
        : outputKind === "preview"
          ? "Preview mix is short by design. Render full mix for the complete clip."
          : "Switch instantly to hear what the model removed or kept.");
  const previewBadge =
    outputPreviewSeconds && outputPreviewSeconds > 0
      ? `Preview · ${outputPreviewSeconds}s`
      : "Preview";
  const hasOutput = Boolean(outputUrl);
  const canToggle = Boolean(inputUrl && outputUrl);
  const showCancel = status === "rendering" && Boolean(onCancel);
  const showRestart = (status === "error" || status === "cancelled") && Boolean(onRestart);
  const restartLabel = renderMode === "preview" ? "Restart preview" : "Restart mix";

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      setActiveSide(outputUrl ? "processed" : "original");
    });
    return () => {
      cancelled = true;
    };
  }, [outputUrl]);

  const handleToggle = () => {
    if (!canToggle) {
      return;
    }
    const nextSide = activeSide === "original" ? "processed" : "original";
    const fromEl = activeSide === "original" ? originalRef.current : processedRef.current;
    const toEl = nextSide === "original" ? originalRef.current : processedRef.current;
    if (!fromEl || !toEl) {
      setActiveSide(nextSide);
      return;
    }
    const wasPlaying = !fromEl.paused;
    const time = fromEl.currentTime;
    fromEl.pause();
    toEl.pause();
    const duration = Number.isFinite(toEl.duration) ? toEl.duration : 0;
    const nextTime = duration > 0 ? Math.min(time, duration) : time;
    try {
      toEl.currentTime = nextTime;
    } catch {
      // ignore seek errors before metadata loads
    }
    if (wasPlaying) {
      void toEl.play();
    }
    setActiveSide(nextSide);
  };

  return (
    <section className="panel span-12">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">A/B Player</p>
          <h2 className="panel-title">Compare original and processed audio</h2>
        </div>
        <div className="panel-tags">
          <span className="panel-tag" data-testid="ab-status">
            {statusLabel}
          </span>
          {elapsedLabel ? <span className="panel-tag panel-tag-muted">{elapsedLabel}</span> : null}
          {progressLabel ? (
            <span className="panel-tag panel-tag-muted">{progressLabel}</span>
          ) : null}
          {percentLabel && !progressLabel ? (
            <span className="panel-tag panel-tag-muted">{percentLabel}</span>
          ) : null}
          {etaLabel ? <span className="panel-tag panel-tag-muted">{etaLabel}</span> : null}
          {outputKind ? (
            <span
              className={`panel-tag ${outputKind === "preview" ? "panel-tag-preview" : "panel-tag-full"}`}
            >
              {outputKind === "preview" ? previewBadge : "Full"}
            </span>
          ) : null}
        </div>
      </div>
      <div className="ab-controls">
        <button
          className="cta-button"
          type="button"
          onClick={onRender}
          disabled={disabled}
          data-testid="render-mix"
        >
          Render mix
        </button>
        {onRenderPreview ? (
          <button
            className="ghost-button"
            type="button"
            onClick={onRenderPreview}
            disabled={previewDisabled ?? disabled}
            data-testid="render-preview"
          >
            Render preview
          </button>
        ) : null}
        {onRenderPreview && previewSeconds !== undefined && onPreviewSecondsChange ? (
          <div className="ab-preview">
            <label className="ab-label" htmlFor="preview-seconds">
              Preview length
            </label>
            <select
              id="preview-seconds"
              className="ab-select"
              value={selectValue}
              onChange={(event) => onPreviewSecondsChange(Number(event.target.value))}
              disabled={previewDisabled ?? disabled}
              data-testid="preview-length"
            >
              {options.map((value) =>
                value === -1 ? (
                  <option key="custom" value={-1}>
                    Custom
                  </option>
                ) : (
                  <option key={value} value={value}>
                    {value}s
                  </option>
                ),
              )}
            </select>
            {showCustom ? (
              <input
                className="ab-input"
                type="number"
                min={0.5}
                max={120}
                step={0.1}
                value={previewSeconds ?? ""}
                placeholder="Seconds"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) {
                    onPreviewSecondsChange(0);
                    return;
                  }
                  onPreviewSecondsChange(Math.min(Math.max(next, 0.5), 120));
                }}
                disabled={previewDisabled ?? disabled}
              />
            ) : null}
            {onPreviewStartChange ? (
              <>
                <label className="ab-label" htmlFor="preview-start">
                  Start at
                </label>
                <input
                  id="preview-start"
                  className="ab-input"
                  type="number"
                  min={0}
                  step={0.1}
                  value={previewStartSeconds ?? 0}
                  placeholder="Seconds"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) {
                      onPreviewStartChange(0);
                      return;
                    }
                    onPreviewStartChange(Math.max(next, 0));
                  }}
                  disabled={previewDisabled ?? disabled}
                  data-testid="preview-start"
                />
              </>
            ) : null}
            {onPreviewReset ? (
              <button
                className="ghost-button small"
                type="button"
                onClick={onPreviewReset}
                disabled={previewDisabled ?? disabled}
              >
                Reset
              </button>
            ) : null}
          </div>
        ) : null}
        {showCancel ? (
          <button className="ghost-button" type="button" onClick={onCancel} data-testid="mix-cancel">
            Cancel
          </button>
        ) : null}
        {showRestart ? (
          <button
            className="ghost-button"
            type="button"
            onClick={onRestart}
            data-testid="mix-restart"
          >
            {restartLabel}
          </button>
        ) : null}
        {outputUrl ? (
          <a className="ghost-button" href={outputUrl} target="_blank" rel="noreferrer">
            Download mix
          </a>
        ) : (
          <button className="ghost-button" type="button" disabled>
            Download mix
          </button>
        )}
        <button
          className="ab-toggle"
          type="button"
          onClick={handleToggle}
          disabled={!canToggle}
          aria-pressed={activeSide === "processed"}
          data-testid="ab-toggle"
        >
          <span className={activeSide === "original" ? "ab-toggle-active" : undefined}>
            Original
          </span>
          <div className={`ab-switch ${activeSide === "processed" ? "is-processed" : ""}`} />
          <span className={activeSide === "processed" ? "ab-toggle-active" : undefined}>
            Processed
          </span>
        </button>
      </div>
      {inputUrl && (hasOutput || activeSide === "original") ? (
        <div className="ab-output">
          <audio
            ref={originalRef}
            controls
            preload="auto"
            src={inputUrl}
            className={activeSide === "original" ? "ab-audio-active" : "ab-audio-hidden"}
            data-testid="audio-original"
          />
          {outputUrl ? (
            <audio
              ref={processedRef}
              controls
              preload="auto"
              src={outputUrl}
              className={activeSide === "processed" ? "ab-audio-active" : "ab-audio-hidden"}
              data-testid="audio-processed"
            />
          ) : null}
        </div>
      ) : null}
      {fullInputUrl ? (
        <div className="ab-output full-output">
          <div className="panel-header compact">
            <div>
              <p className="panel-kicker">Complete Original</p>
              <h2 className="panel-title">Full-length reference</h2>
            </div>
          </div>
          <audio controls preload="auto" src={fullInputUrl} />
        </div>
      ) : null}
      <p className="panel-meta">{metaCopy}</p>
    </section>
  );
}
