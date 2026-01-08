"use client";

type WaveformPanelProps = {
  message?: string;
};

export function WaveformPanel({ message }: WaveformPanelProps) {
  return (
    <section className="panel span-12">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Timeline</p>
          <h2 className="panel-title">Waveform and regions</h2>
        </div>
        <span className="panel-tag">Preview 10s</span>
      </div>
      <div className="waveform">
        <div className="waveform-bars" />
        <div className="waveform-region">Region A</div>
        <div className="waveform-region region-alt">Region B</div>
      </div>
      <p className="panel-meta">
        {message ??
          "Click a region to compare A/B audio without reprocessing the full track."}
      </p>
    </section>
  );
}
