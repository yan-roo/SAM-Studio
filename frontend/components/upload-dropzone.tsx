"use client";

import type { ChangeEvent } from "react";

type UploadDropzoneProps = {
  onSelect: (file: File) => void;
  disabled?: boolean;
  fileName?: string | null;
};

export function UploadDropzone({ onSelect, disabled, fileName }: UploadDropzoneProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onSelect(file);
      event.target.value = "";
    }
  };

  return (
    <section className="panel span-4">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Upload</p>
          <h2 className="panel-title">Drop a file to analyze</h2>
        </div>
        <span className="panel-tag">.wav .mp3 .m4a .mp4</span>
      </div>
      <label className="dropzone">
        <input
          className="dropzone-input"
          type="file"
          accept=".wav,.mp3,.m4a,.mp4"
          onChange={handleChange}
          disabled={disabled}
          data-testid="upload-input"
        />
        <span>{disabled ? "Uploading..." : "Drop a file or click to browse"}</span>
        {fileName ? <span className="dropzone-file">{fileName}</span> : null}
      </label>
      <p className="panel-meta">Video inputs are converted to 16kHz mono WAV.</p>
    </section>
  );
}
