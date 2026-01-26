"use client";

import { useState } from "react";

import type { Candidate, CandidateSegment } from "@/lib/types";

type CandidatesPanelProps = {
  candidates: Candidate[];
  isLoading?: boolean;
  selected: Record<string, boolean>;
  onToggle: (label: string) => void;
  onSelectAll?: () => void;
  onClearAll?: () => void;
  onAddPrompt?: (label: string) => void;
  onPreviewSegment?: (label: string, segment: CandidateSegment) => void;
};

export function CandidatesPanel({
  candidates,
  isLoading,
  selected,
  onToggle,
  onSelectAll,
  onClearAll,
  onAddPrompt,
  onPreviewSegment,
}: CandidatesPanelProps) {
  const hasCandidates = candidates.length > 0;
  const [promptValue, setPromptValue] = useState("");
  const promptDisabled = Boolean(isLoading) || !onAddPrompt;
  const trimmedPrompt = promptValue.trim();
  const segmentLimit = 4;
  const toTestId = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const formatTimestamp = (value: number) => {
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const formatSegmentLabel = (segment: CandidateSegment) =>
    `${formatTimestamp(segment.t0)}–${formatTimestamp(segment.t1)}`;

  const handleAddPrompt = () => {
    if (!onAddPrompt) {
      return;
    }
    if (!trimmedPrompt) {
      return;
    }
    onAddPrompt(trimmedPrompt);
    setPromptValue("");
  };
  return (
    <section className="panel span-7" data-testid="candidates-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Candidates</p>
          <h2 className="panel-title">Top labels with segments</h2>
        </div>
        <div className="panel-actions">
          <span className="panel-tag">{hasCandidates ? `Top ${candidates.length}` : "Top N"}</span>
          {hasCandidates ? (
            <>
              <button
                className="ghost-button small"
                type="button"
                onClick={onSelectAll}
                data-testid="candidate-select-all"
              >
                Select all
              </button>
              <button
                className="ghost-button small"
                type="button"
                onClick={onClearAll}
                data-testid="candidate-clear"
              >
                Clear
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="candidate-list" data-testid="candidate-list">
        {hasCandidates ? (
          candidates.map((item) => {
            const isSelected = Boolean(selected[item.label]);
            const segments = item.segments ?? [];
            const visibleSegments = segments.slice(0, segmentLimit);
            const testId = toTestId(item.label);
            return (
              <div
                key={item.label}
                className={`candidate-row ${isSelected ? "selected" : ""}`}
                data-testid={`candidate-${testId}`}
              >
                <div className="candidate-info">
                  <p className="candidate-label">{item.label}</p>
                  <p className="candidate-meta">
                    {Math.round(item.score * 100)}% ·{" "}
                    {item.segments.length
                      ? `${item.segments.length} seg`
                      : item.source === "prompt"
                        ? "Prompt"
                        : "Auto"}
                  </p>
                  <div className="candidate-segments">
                    {visibleSegments.length ? (
                      <>
                        {visibleSegments.map((segment, index) => (
                          <button
                            key={`${item.label}-${index}-${segment.t0}`}
                            className="segment-chip"
                            type="button"
                            onClick={() => onPreviewSegment?.(item.label, segment)}
                            disabled={!onPreviewSegment}
                            title={`Preview ${formatSegmentLabel(segment)}`}
                          >
                            {formatSegmentLabel(segment)}
                          </button>
                        ))}
                        {segments.length > segmentLimit ? (
                          <span className="segment-overflow">
                            +{segments.length - segmentLimit} more
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="segment-note">
                        {item.source === "prompt" ? "Prompt only" : "No segments yet"}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="candidate-toggle"
                  type="button"
                  onClick={() => onToggle(item.label)}
                  disabled={isLoading}
                  data-testid={`candidate-toggle-${testId}`}
                >
                  {isSelected ? "Selected" : "Add"}
                </button>
              </div>
            );
          })
        ) : (
          <div className="candidate-empty">
            {isLoading ? "Detecting candidates..." : "No candidates yet"}
          </div>
        )}
      </div>
      <div className="prompt-row">
        <input
          className="prompt-input"
          type="text"
          placeholder="Add prompt (e.g. air conditioner hum)"
          value={promptValue}
          onChange={(event) => setPromptValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleAddPrompt();
            }
          }}
          disabled={promptDisabled}
          data-testid="prompt-input"
        />
        <button
          className="ghost-button"
          type="button"
          onClick={handleAddPrompt}
          disabled={promptDisabled || !trimmedPrompt}
          data-testid="prompt-add"
        >
          Add prompt
        </button>
      </div>
      <p className="panel-meta">
        Click a segment to set the preview window, then use Render preview. Free-text
        prompts are supported even if not in the AudioSet label map.
      </p>
    </section>
  );
}
