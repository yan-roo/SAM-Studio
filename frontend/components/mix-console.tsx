"use client";

type MixConsoleProps = {
  items: Array<{ label: string; gain: number }>;
  mode: "keep" | "remove";
  onModeChange: (mode: "keep" | "remove") => void;
  onGainChange: (label: string, gain: number) => void;
  onRemove?: (label: string) => void;
};

export function MixConsole({
  items,
  mode,
  onModeChange,
  onGainChange,
  onRemove,
}: MixConsoleProps) {
  const isRemove = mode === "remove";
  const toTestId = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const metaCopy =
    items.length > 0
      ? isRemove
        ? "Remove mode ignores gain. Switch to Keep to adjust loudness."
        : "Sequential extraction avoids overlap artifacts."
      : "Select candidates to enable mix controls.";
  return (
    <section className={`panel span-5 mix-console ${isRemove ? "is-locked" : ""}`}>
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Mix Console</p>
          <h2 className="panel-title">{mode === "keep" ? "Keep mode" : "Remove mode"}</h2>
        </div>
        <span className={`panel-tag ${isRemove ? "panel-tag-muted" : ""}`}>
          {isRemove ? "Gain locked" : "0-200%"}
        </span>
      </div>
      <div className="mix-mode">
        <button
          className={`mode-button ${mode === "keep" ? "active" : ""}`}
          type="button"
          onClick={() => onModeChange("keep")}
          data-testid="mix-mode-keep"
        >
          Keep
        </button>
        <button
          className={`mode-button ${mode === "remove" ? "active" : ""}`}
          type="button"
          onClick={() => onModeChange("remove")}
          data-testid="mix-mode-remove"
        >
          Remove
        </button>
      </div>
      {items.length > 0 ? (
        <div className="fader-grid">
          {items.map((channel) => {
            const sliderId = `gain-${channel.label.replace(/\s+/g, "-").toLowerCase()}`;
            const testId = toTestId(channel.label);
            return (
              <div key={channel.label} className="fader">
                <div className="fader-header">
                  <label className="fader-label" htmlFor={sliderId}>
                    {channel.label}
                  </label>
                  {onRemove ? (
                    <button
                      className="fader-remove"
                      type="button"
                      onClick={() => onRemove(channel.label)}
                      aria-label={`Remove ${channel.label}`}
                      data-testid={`remove-${testId}`}
                    >
                      x
                    </button>
                  ) : null}
                </div>
                <input
                  id={sliderId}
                  className="fader-range"
                  type="range"
                  min={0}
                  max={200}
                  step={1}
                  value={Math.round(channel.gain * 100)}
                  onChange={(event) =>
                    onGainChange(channel.label, Number(event.target.value) / 100)
                  }
                  disabled={isRemove}
                  data-testid={`gain-${testId}`}
                />
                <p className="fader-value">{Math.round(channel.gain * 100)}%</p>
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="panel-meta">{metaCopy}</p>
    </section>
  );
}
