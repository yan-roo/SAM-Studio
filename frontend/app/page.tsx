"use client";

import { useEffect, useRef, useState } from "react";
import { ABPlayer } from "@/components/ab-player";
import { CandidatesPanel } from "@/components/candidates-panel";
import { JobStatus } from "@/components/job-status";
import { MixConsole } from "@/components/mix-console";
import { UploadDropzone } from "@/components/upload-dropzone";
import { WaveformPanel } from "@/components/waveform";
import {
  cancelMix,
  createJob,
  createMix,
  deleteJob,
  cleanupJobs,
  getMixStatus,
  listJobs,
  resolveApiUrl,
} from "@/lib/api";
import type { Candidate, CandidateSegment, Job } from "@/lib/types";

type MixItemState = {
  selected: boolean;
  gain: number;
};

const PREVIEW_STORAGE_KEY = "sam-audio-preview-seconds";
const PREVIEW_OPTIONS = [5, 10, 20, 30, -1];
const DEFAULT_PREVIEW_SECONDS = 10;
const DEFAULT_CUSTOM_PREVIEW_SECONDS = 12;

const readStoredPreviewSeconds = () => {
  const raw = window.localStorage.getItem(PREVIEW_STORAGE_KEY);
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_PREVIEW_SECONDS;
};

export default function Home() {
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mixMode, setMixMode] = useState<"keep" | "remove">("keep");
  const [mixItems, setMixItems] = useState<Record<string, MixItemState>>({});
  const [mixStatus, setMixStatus] = useState<
    "idle" | "rendering" | "ready" | "error" | "cancelled"
  >("idle");
  const [mixError, setMixError] = useState<string | null>(null);
  const [mixProgress, setMixProgress] = useState<number | null>(null);
  const [mixChunksDone, setMixChunksDone] = useState<number | null>(null);
  const [mixChunksTotal, setMixChunksTotal] = useState<number | null>(null);
  const [mixEtaSeconds, setMixEtaSeconds] = useState<number | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputKind, setOutputKind] = useState<"preview" | "full" | null>(null);
  const [outputPreviewSeconds, setOutputPreviewSeconds] = useState<number | null>(null);
  const [outputPreviewStartSeconds, setOutputPreviewStartSeconds] = useState<number | null>(
    null,
  );
  const [renderMode, setRenderMode] = useState<"preview" | "full" | null>(null);
  const [previewSeconds, setPreviewSeconds] = useState(DEFAULT_PREVIEW_SECONDS);
  const [previewCustomSeconds, setPreviewCustomSeconds] = useState(
    DEFAULT_CUSTOM_PREVIEW_SECONDS,
  );
  const [previewStartSeconds, setPreviewStartSeconds] = useState(0);
  const [customCandidates, setCustomCandidates] = useState<Candidate[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const mixPollTimerRef = useRef<number | null>(null);
  const mixRequestIdRef = useRef(0);
  const mixStartRef = useRef<number | null>(null);
  const [mixElapsedSeconds, setMixElapsedSeconds] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [jobHistory, setJobHistory] = useState<Job[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [historySort, setHistorySort] = useState("updated_desc");
  const [cleanupKeepLatest, setCleanupKeepLatest] = useState("");
  const [cleanupOutputs, setCleanupOutputs] = useState(false);
  const [cleanupCache, setCleanupCache] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const mixRequestMetaRef = useRef<{
    kind: "preview" | "full";
    previewSeconds: number | null;
    previewStart: number | null;
    cacheBust: string;
  } | null>(null);

  const normalizeText = (value: string) =>
    value.trim().toLowerCase().replace(/\s+/g, " ");
  const appendCacheBust = (url: string, token: string) => {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${encodeURIComponent(token)}`;
  };
  const candidates = [...(job?.candidates ?? []), ...customCandidates];

  const resetMixState = () => {
    setMixMode("keep");
    setMixItems({});
    setCustomCandidates([]);
    setMixStatus("idle");
    setMixError(null);
    setMixProgress(null);
    setMixChunksDone(null);
    setMixChunksTotal(null);
    setMixEtaSeconds(null);
    setOutputUrl(null);
    setOutputKind(null);
    setOutputPreviewSeconds(null);
    setOutputPreviewStartSeconds(null);
    setRenderMode(null);
  };

  const buildDefaultMixItems = (items?: Candidate[] | null) => {
    const nextItems: Record<string, MixItemState> = {};
    items?.forEach((candidate, index) => {
      nextItems[candidate.label] = {
        selected: index < 4,
        gain: 1.0,
      };
    });
    return nextItems;
  };

  const handleSelect = async (file: File) => {
    setStatus("uploading");
    setError(null);
    setFileName(file.name);
    resetMixState();
    try {
      const result = await createJob(file, { topN: 12, useYamnet: true });
      const nextItems = buildDefaultMixItems(result.candidates);
      setJob(result);
      setMixMode("keep");
      setMixItems(nextItems);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const loadJobHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const jobs = await listJobs();
      setJobHistory(jobs);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleToggleHistory = () => {
    const nextOpen = !historyOpen;
    setHistoryOpen(nextOpen);
    if (nextOpen) {
      void loadJobHistory();
    }
  };

  const formatJobStamp = (value?: string | null) => {
    if (!value) {
      return "--";
    }
    return value.replace("T", " ").replace("Z", "");
  };

  const formatDuration = (value?: number | null) => {
    if (!value || !Number.isFinite(value)) {
      return "--";
    }
    const total = Math.round(value);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  };

  const formatPreviewRange = (start?: number | null, length?: number | null) => {
    if (!length || length <= 0) {
      return null;
    }
    const startSeconds = start && start > 0 ? start : 0;
    const endSeconds = startSeconds + length;
    return `${startSeconds}s–${endSeconds}s`;
  };

  const handleLoadJob = (selected: Job) => {
    resetMixState();
    setJob(selected);
    setFileName(`Job ${selected.id.slice(0, 8)}`);
    setError(selected.detail ?? null);
    setStatus(
      selected.status === "DONE"
        ? "done"
        : selected.status === "FAILED"
          ? "error"
          : "uploading",
    );
    setMixItems(buildDefaultMixItems(selected.candidates));
    if (selected.last_mix) {
      const outputUrl = resolveApiUrl(
        `/assets/${selected.id}/output?name=${selected.last_mix.output_name}`,
      );
      setOutputUrl(outputUrl);
      setOutputKind(selected.last_mix.kind);
      setOutputPreviewSeconds(
        selected.last_mix.kind === "preview"
          ? selected.last_mix.preview_seconds ?? null
          : null,
      );
      setOutputPreviewStartSeconds(
        selected.last_mix.kind === "preview"
          ? selected.last_mix.preview_start ?? null
          : null,
      );
      setMixStatus("ready");
      setMixProgress(1);
      setMixEtaSeconds(0);
    }
    setHistoryOpen(false);
  };

  const handleCleanup = async () => {
    setCleanupMessage(null);
    const keepLatestValue = cleanupKeepLatest.trim();
    const keepLatest = keepLatestValue ? Number(keepLatestValue) : undefined;
    const payload = {
      keepLatest: Number.isFinite(keepLatest) ? Math.max(0, keepLatest) : undefined,
      clearOutputs: cleanupOutputs,
      clearCache: cleanupCache,
    };
    if (
      payload.keepLatest === undefined &&
      payload.clearOutputs !== true &&
      payload.clearCache !== true
    ) {
      setCleanupMessage("Select a cleanup action first.");
      return;
    }
    const confirmed = window.confirm("Run cleanup? This can delete files permanently.");
    if (!confirmed) {
      return;
    }
    try {
      const result = await cleanupJobs(payload);
      setCleanupMessage(
        `Removed ${result.removed_jobs.length} job(s), cleared outputs for ${result.cleared_outputs} job(s).`,
      );
      void loadJobHistory();
    } catch (err) {
      setCleanupMessage(err instanceof Error ? err.message : "Cleanup failed");
    }
  };

  const filteredHistory = jobHistory
    .filter((entry) => {
      if (historyStatus !== "all" && entry.status !== historyStatus) {
        return false;
      }
      if (!historyQuery.trim()) {
        return true;
      }
      const query = historyQuery.trim().toLowerCase();
      return (
        entry.id.toLowerCase().includes(query) ||
        (entry.file_name ?? "").toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      const aTime = new Date(a.updated_at ?? a.created_at).getTime();
      const bTime = new Date(b.updated_at ?? b.created_at).getTime();
      if (historySort === "updated_asc") {
        return aTime - bTime;
      }
      return bTime - aTime;
    });
  const handleDeleteJob = async (entry: Job) => {
    try {
      await deleteJob(entry.id);
      setJobHistory((prev) => prev.filter((job) => job.id !== entry.id));
      if (job?.id === entry.id) {
        setJob(null);
        setStatus("idle");
        setError(null);
        setFileName(null);
        resetMixState();
      }
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to delete job");
    }
  };

  const handleToggleCandidate = (label: string) => {
    setMixItems((prev) => {
      const current = prev[label];
      if (!current) {
        return prev;
      }
      return { ...prev, [label]: { ...current, selected: !current.selected } };
    });
  };

  const handleSelectAll = () => {
    setMixItems((prev) => {
      const next: Record<string, MixItemState> = {};
      for (const [label, item] of Object.entries(prev)) {
        next[label] = { ...item, selected: true };
      }
      return next;
    });
  };

  const handleClearAll = () => {
    setMixItems((prev) => {
      const next: Record<string, MixItemState> = {};
      for (const [label, item] of Object.entries(prev)) {
        next[label] = { ...item, selected: false };
      }
      return next;
    });
  };

  const handleAddPrompt = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }
    const normalized = normalizeText(trimmed);
    const existing = candidates.find(
      (candidate) => normalizeText(candidate.label) === normalized,
    );
    if (existing) {
      setMixItems((prev) => {
        const current = prev[existing.label] ?? { selected: false, gain: 1.0 };
        return { ...prev, [existing.label]: { ...current, selected: true } };
      });
      return;
    }
    const promptCandidate: Candidate = {
      label: trimmed,
      score: 0,
      segments: [],
      source: "prompt",
    };
    setCustomCandidates((prev) => {
      if (prev.some((candidate) => normalizeText(candidate.label) === normalized)) {
        return prev;
      }
      return [...prev, promptCandidate];
    });
    setMixItems((prev) => ({
      ...prev,
      [promptCandidate.label]: { selected: true, gain: 1.0 },
    }));
  };

  const showToast = (message: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2400);
  };

  const stopMixPolling = () => {
    if (mixPollTimerRef.current) {
      window.clearTimeout(mixPollTimerRef.current);
      mixPollTimerRef.current = null;
    }
  };

  const resetMixProgress = () => {
    setMixProgress(null);
    setMixChunksDone(null);
    setMixChunksTotal(null);
    setMixEtaSeconds(null);
  };

  useEffect(() => {
    const stored = readStoredPreviewSeconds();
    setPreviewSeconds(stored);
    setPreviewCustomSeconds(
      PREVIEW_OPTIONS.includes(stored) ? DEFAULT_CUSTOM_PREVIEW_SECONDS : stored,
    );
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      stopMixPolling();
    };
  }, []);

  useEffect(() => {
    if (mixStatus !== "rendering") {
      mixStartRef.current = null;
      setMixElapsedSeconds(null);
      return;
    }
    if (!mixStartRef.current) {
      mixStartRef.current = Date.now();
    }
    const tick = () => {
      if (!mixStartRef.current) {
        return;
      }
      const elapsed = Math.max(0, Math.floor((Date.now() - mixStartRef.current) / 1000));
      setMixElapsedSeconds(elapsed);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [mixStatus]);


  const handleGainChange = (label: string, gain: number) => {
    setMixItems((prev) => {
      const current = prev[label];
      if (!current) {
        return prev;
      }
      return { ...prev, [label]: { ...current, gain } };
    });
  };

  const persistPreviewSeconds = (value: number) => {
    setPreviewSeconds(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PREVIEW_STORAGE_KEY, String(value));
    }
  };

  const handlePreviewSecondsChange = (value: number) => {
    if (value === -1) {
      persistPreviewSeconds(previewCustomSeconds);
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    persistPreviewSeconds(value);
    if (!PREVIEW_OPTIONS.includes(value)) {
      setPreviewCustomSeconds(value);
    }
  };

  const handlePreviewReset = () => {
    persistPreviewSeconds(DEFAULT_PREVIEW_SECONDS);
    setPreviewStartSeconds(0);
  };

  const resolvePreviewSeconds = (value: number) => {
    if (value === -1) {
      return null;
    }
    if (value <= 0) {
      return null;
    }
    return value;
  };

  const handlePreviewStartChange = (value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }
    setPreviewStartSeconds(Math.max(0, value));
  };

  const resolvePreviewStart = (value: number) => {
    if (!Number.isFinite(value)) {
      return null;
    }
    if (value <= 0) {
      return 0;
    }
    return value;
  };

  const applyPreviewWindow = (start: number, duration: number, label?: string) => {
    const normalizedStart = Math.max(0, Math.round(start * 10) / 10);
    const normalizedDuration = Math.min(120, Math.max(0.5, Math.round(duration * 10) / 10));
    setPreviewStartSeconds(normalizedStart);
    persistPreviewSeconds(normalizedDuration);
    if (!PREVIEW_OPTIONS.includes(normalizedDuration)) {
      setPreviewCustomSeconds(normalizedDuration);
    }
    const labelText = label ? ` · ${label}` : "";
    showToast(`Preview set${labelText} · ${normalizedDuration}s @ ${normalizedStart}s`);
  };

  const handlePreviewSegment = (label: string, segment: CandidateSegment) => {
    const duration = Math.max(segment.t1 - segment.t0, 0.5);
    applyPreviewWindow(segment.t0, duration, label);
  };

  const pollMixStatus = async (jobId: string, requestId: number) => {
    try {
      const result = await getMixStatus(jobId);
      if (requestId !== mixRequestIdRef.current) {
        return;
      }
      if (result.status === "RUNNING") {
        setMixStatus("rendering");
        setMixProgress(result.progress ?? null);
        setMixChunksDone(result.chunks_done ?? null);
        setMixChunksTotal(result.chunks_total ?? null);
        setMixEtaSeconds(result.eta_seconds ?? null);
      }
      if (result.status === "DONE" && result.output_url) {
        const meta = mixRequestMetaRef.current;
        const resolvedUrl = appendCacheBust(
          resolveApiUrl(result.output_url),
          meta?.cacheBust ?? String(requestId),
        );
        setOutputUrl(resolvedUrl);
        if (meta) {
          setOutputKind(meta.kind);
          setOutputPreviewSeconds(meta.kind === "preview" ? meta.previewSeconds : null);
          setOutputPreviewStartSeconds(meta.kind === "preview" ? meta.previewStart : null);
        }
        setMixStatus("ready");
        setMixProgress(1);
        setMixEtaSeconds(0);
        return;
      }
      if (result.status === "CANCELLED") {
        setMixStatus("cancelled");
        setMixError(result.detail ?? "Mix cancelled");
        return;
      }
      if (result.status === "FAILED") {
        setMixStatus("error");
        setMixError(result.detail ?? "Mix failed");
        return;
      }
    } catch (err) {
      if (requestId !== mixRequestIdRef.current) {
        return;
      }
      setMixStatus("error");
      setMixError(err instanceof Error ? err.message : "Mix failed");
      return;
    }
    mixPollTimerRef.current = window.setTimeout(
      () => pollMixStatus(jobId, requestId),
      2000,
    );
  };

  const handleRenderMix = async (preview = false, force = false) => {
    if (!job) {
      return;
    }
    const selected = candidates.filter((candidate) => mixItems[candidate.label]?.selected);
    if (!selected.length) {
      setMixStatus("error");
      setMixError("Select at least one candidate.");
      return;
    }
    const prompts = selected.map((item) => normalizeText(item.label));
    const gains = selected.map((item) => mixItems[item.label]?.gain ?? 1.0);
    setMixStatus("rendering");
    setMixError(null);
    resetMixProgress();
    setMixProgress(0);
    mixStartRef.current = Date.now();
    setMixElapsedSeconds(0);
    setRenderMode(preview ? "preview" : "full");
    stopMixPolling();
    mixRequestIdRef.current += 1;
    const requestId = mixRequestIdRef.current;
    const requestKind = preview ? "preview" : "full";
    const cacheBust = `${requestId}-${Date.now()}`;
    mixRequestMetaRef.current = {
      kind: requestKind,
      previewSeconds: preview ? previewSeconds : null,
      previewStart: preview ? previewStartSeconds : null,
      cacheBust,
    };
    try {
      const resolvedPreview = resolvePreviewSeconds(previewSeconds);
      const resolvedPreviewStart = resolvePreviewStart(previewStartSeconds);
      const result = await createMix(job.id, {
        prompts,
        gains,
        mode: mixMode,
        preview,
        previewSeconds: resolvedPreview ?? undefined,
        previewStart:
          preview && resolvedPreviewStart !== null && resolvedPreviewStart > 0
            ? resolvedPreviewStart
            : undefined,
        force,
      });
      if (result.status === "DONE" && result.output_url) {
        const resolvedUrl = appendCacheBust(resolveApiUrl(result.output_url), cacheBust);
        setOutputUrl(resolvedUrl);
        setOutputKind(preview ? "preview" : "full");
        setOutputPreviewSeconds(preview ? previewSeconds : null);
        setOutputPreviewStartSeconds(preview ? previewStartSeconds : null);
        setMixStatus("ready");
        setMixProgress(1);
        setMixEtaSeconds(0);
        if (preview) {
          showToast(`Preview ready · ${previewSeconds}s`);
        }
      } else if (result.status === "CANCELLED") {
        setMixStatus("cancelled");
        setMixError(result.detail ?? "Mix cancelled");
      } else if (result.status === "FAILED") {
        setMixStatus("error");
        setMixError(result.detail ?? "Mix failed");
      } else {
        setMixProgress((prev) => result.progress ?? prev);
        setMixChunksDone((prev) => result.chunks_done ?? prev);
        setMixChunksTotal((prev) => result.chunks_total ?? prev);
        setMixEtaSeconds((prev) => result.eta_seconds ?? prev);
        pollMixStatus(job.id, requestId);
      }
    } catch (err) {
      setMixStatus("error");
      setMixError(err instanceof Error ? err.message : "Mix failed");
    }
  };

  const handleCancelMix = async () => {
    if (!job) {
      return;
    }
    stopMixPolling();
    try {
      const result = await cancelMix(job.id);
      if (result.status === "CANCELLED") {
        setMixStatus("cancelled");
        setMixError(result.detail ?? "Mix cancelled");
        showToast("Mix cancelled");
      } else if (result.status === "DONE" && result.output_url) {
        setOutputUrl(appendCacheBust(resolveApiUrl(result.output_url), String(Date.now())));
        setMixError(null);
        setMixStatus("ready");
      } else if (result.status === "FAILED") {
        setMixStatus("error");
        setMixError(result.detail ?? "Mix failed");
      } else if (result.status === "RUNNING") {
        setMixStatus("rendering");
        mixRequestIdRef.current += 1;
        pollMixStatus(job.id, mixRequestIdRef.current);
      } else {
        setMixStatus("idle");
      }
    } catch (err) {
      setMixStatus("error");
      setMixError(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  const handleRestartMix = () => {
    const preview = renderMode === "preview";
    void handleRenderMix(preview, true);
  };

  const statusTitle =
    status === "uploading"
      ? "Analyzing audio..."
      : status === "done"
        ? "Candidates ready"
        : status === "error"
          ? "Analysis failed"
          : "Ready for analysis";
  const statusTag =
    status === "uploading"
      ? "Running"
      : status === "done"
        ? "Complete"
        : status === "error"
          ? "Failed"
          : "Idle";
  const previewLabel =
    previewSeconds > 0
      ? previewStartSeconds > 0
        ? `${previewSeconds}s @ ${previewStartSeconds}s`
        : `${previewSeconds}s`
      : "--";
  const stats = [
    { label: "Status", value: statusTag },
    { label: "Job", value: job?.id ? job.id.slice(0, 8) : "--" },
    { label: "Candidates", value: candidates.length ? `${candidates.length}` : "--" },
    { label: "Preview", value: previewLabel },
    { label: "Cache", value: "On" },
  ];
  const baseInputUrl = job?.id ? resolveApiUrl(`/assets/${job.id}/input`) : null;
  const fullInputUrl = baseInputUrl;
  const previewInputUrl =
    baseInputUrl &&
    outputKind === "preview" &&
    outputPreviewSeconds &&
    outputPreviewSeconds > 0
      ? (() => {
          const params = new URLSearchParams();
          params.set("preview_seconds", String(outputPreviewSeconds));
          if (outputPreviewStartSeconds && outputPreviewStartSeconds > 0) {
            params.set("preview_start", String(outputPreviewStartSeconds));
          }
          return `${baseInputUrl}?${params.toString()}`;
        })()
      : null;
  const inputUrl = previewInputUrl ?? baseInputUrl;
  const note =
    status === "uploading"
      ? "Running YAMNet candidate detection on the uploaded clip."
      : status === "done"
        ? "Select candidates or add prompts to continue separation."
        : "Upload a file to generate candidates with YAMNet and preview segments.";
  const canAddPrompt = status === "done";

  const mixList = candidates
    .filter((candidate) => mixItems[candidate.label]?.selected)
    .map((candidate) => ({
      label: candidate.label,
      gain: mixItems[candidate.label]?.gain ?? 1.0,
    }));
  const canRender = Boolean(job && mixList.length > 0);
  const selectedCandidates = candidates.filter(
    (candidate) => mixItems[candidate.label]?.selected,
  );
  const segmentCandidates = selectedCandidates.length
    ? selectedCandidates
    : candidates.slice(0, 3);
  const waveformSegments = segmentCandidates
    .flatMap((candidate) =>
      (candidate.segments ?? []).map((segment) => ({
        ...segment,
        label: candidate.label,
      })),
    )
    .slice(0, 40);

  return (
    <div className="page">
      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
      <header className="hero">
        <p className="eyebrow">SAM-Studio</p>
        <h1 className="title">Mix audio with smart prompts.</h1>
        <p className="subtitle">
          Upload a clip, pick the sounds you want, and render a clean A/B mix.
        </p>
        <div className="hero-actions">
          <button className="cta-button" type="button">
            Start a new analysis
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={handleToggleHistory}
            aria-expanded={historyOpen}
            data-testid="history-toggle"
          >
            {historyOpen ? "Hide job history" : "View job history"}
          </button>
        </div>
        <div className="hero-metadata">
          <span>Queue: ready</span>
          <span>Cache: enabled</span>
          <span>Model: sam-audio-small</span>
        </div>
      </header>

      {historyOpen ? (
        <section className="panel job-history" data-testid="job-history">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">History</p>
              <h2 className="panel-title">Recent jobs</h2>
              <p className="panel-meta">Reload past analyses or resume the mix.</p>
            </div>
            <div className="panel-actions">
              <button
                className="ghost-button small"
                type="button"
                onClick={loadJobHistory}
                disabled={historyLoading}
                data-testid="history-refresh"
              >
                Refresh
              </button>
              <button className="ghost-button small" type="button" onClick={handleToggleHistory}>
                Close
              </button>
            </div>
          </div>
          <div className="job-history-controls">
            <input
              className="job-history-input"
              type="search"
              placeholder="Search job ID or file name"
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              data-testid="history-search"
            />
            <select
              className="job-history-select"
              value={historyStatus}
              onChange={(event) => setHistoryStatus(event.target.value)}
              data-testid="history-status"
            >
              <option value="all">All statuses</option>
              <option value="DONE">Done</option>
              <option value="FAILED">Failed</option>
              <option value="RUNNING">Running</option>
              <option value="PENDING">Pending</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <select
              className="job-history-select"
              value={historySort}
              onChange={(event) => setHistorySort(event.target.value)}
              data-testid="history-sort"
            >
              <option value="updated_desc">Newest</option>
              <option value="updated_asc">Oldest</option>
            </select>
          </div>
          {historyLoading ? <p className="job-history-note">Loading job history...</p> : null}
          {!historyLoading && historyError ? (
            <p className="job-history-note error">{historyError}</p>
          ) : null}
          {!historyLoading && !historyError ? (
            filteredHistory.length ? (
              <div className="job-history-list" data-testid="history-list">
                {filteredHistory.map((entry) => {
                  const mixCount = entry.mix_history?.length ?? 0;
                  const previewRange = entry.last_mix?.kind === "preview"
                    ? formatPreviewRange(
                        entry.last_mix.preview_start,
                        entry.last_mix.preview_seconds,
                      )
                    : null;
                  return (
                  <div
                    key={entry.id}
                    className="job-history-row"
                    data-testid={`history-row-${entry.id.slice(0, 8)}`}
                  >
                    <button
                      type="button"
                      className="job-history-item"
                      onClick={() => handleLoadJob(entry)}
                    >
                      <div className="job-history-main">
                        <span className="job-history-id">{entry.id.slice(0, 8)}</span>
                        <span
                          className={`job-history-status status-${entry.status.toLowerCase()}`}
                        >
                          {entry.status}
                        </span>
                      </div>
                      <div className="job-history-meta">
                        <span className="job-history-file">
                          {entry.file_name ?? "Untitled file"}
                        </span>
                        <span>
                          Duration: {formatDuration(entry.duration_seconds)}
                        </span>
                        <span>Updated: {formatJobStamp(entry.updated_at ?? entry.created_at)}</span>
                        <span>Mixes: {mixCount}</span>
                        <span>
                          Last mix:{" "}
                          {entry.last_mix
                            ? `${entry.last_mix.kind.toUpperCase()} · ${formatJobStamp(
                                entry.last_mix.updated_at,
                              )}${previewRange ? ` · ${previewRange}` : ""}`
                            : "None"}
                        </span>
                        <span>{entry.candidates?.length ?? 0} candidates</span>
                      </div>
                    </button>
                    <button
                      className="ghost-button small job-history-delete"
                      type="button"
                      onClick={() => void handleDeleteJob(entry)}
                      data-testid={`history-delete-${entry.id.slice(0, 8)}`}
                    >
                      Delete
                    </button>
                  </div>
                  );
                })}
              </div>
            ) : (
              <p className="job-history-note">No matching jobs found.</p>
            )
          ) : null}
          <div className="job-history-cleanup">
            <div>
              <p className="panel-kicker">Cleanup</p>
              <p className="panel-meta">
                Delete old jobs or clear cached outputs to free space.
              </p>
            </div>
            <div className="job-history-cleanup-controls">
              <label className="job-history-field">
                <span>Keep latest N jobs</span>
                <input
                  className="job-history-input small"
                  type="number"
                  min="0"
                  placeholder="e.g. 20"
                  value={cleanupKeepLatest}
                  onChange={(event) => setCleanupKeepLatest(event.target.value)}
                  data-testid="history-keep-latest"
                />
              </label>
              <label className="job-history-toggle">
                <input
                  type="checkbox"
                  checked={cleanupOutputs}
                  onChange={(event) => setCleanupOutputs(event.target.checked)}
                  data-testid="history-clear-outputs"
                />
                <span>Clear outputs</span>
              </label>
              <label className="job-history-toggle">
                <input
                  type="checkbox"
                  checked={cleanupCache}
                  onChange={(event) => setCleanupCache(event.target.checked)}
                  data-testid="history-clear-cache"
                />
                <span>Clear cache</span>
              </label>
              <button
                className="cta-button small"
                type="button"
                onClick={handleCleanup}
                data-testid="history-cleanup-run"
              >
                Run cleanup
              </button>
            </div>
            {cleanupMessage ? (
              <p className="job-history-note">{cleanupMessage}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="workspace">
        <UploadDropzone
          onSelect={handleSelect}
          disabled={status === "uploading"}
          fileName={fileName}
        />
        <JobStatus title={statusTitle} tag={statusTag} stats={stats} note={note} error={error} />
        <WaveformPanel
          audioUrl={fullInputUrl}
          durationSeconds={job?.duration_seconds ?? null}
          segments={waveformSegments}
          previewStartSeconds={previewStartSeconds}
          previewSeconds={previewSeconds}
          onSelectSegment={handlePreviewSegment}
          message={
            job
              ? "Click a segment to set the preview window, then use Render preview."
              : "Upload audio to render the waveform and candidate segments."
          }
        />
        <CandidatesPanel
          candidates={candidates}
          isLoading={status === "uploading"}
          selected={Object.fromEntries(
            candidates.map((candidate) => [
              candidate.label,
              Boolean(mixItems[candidate.label]?.selected),
            ]),
          )}
          onToggle={handleToggleCandidate}
          onSelectAll={handleSelectAll}
          onClearAll={handleClearAll}
          onAddPrompt={canAddPrompt ? handleAddPrompt : undefined}
          onPreviewSegment={handlePreviewSegment}
        />
        <MixConsole
          items={mixList}
          mode={mixMode}
          onModeChange={setMixMode}
          onGainChange={handleGainChange}
          onRemove={handleToggleCandidate}
        />
        <ABPlayer
          onRender={canRender ? () => handleRenderMix(false) : undefined}
          onRenderPreview={canRender ? () => handleRenderMix(true) : undefined}
          disabled={!canRender || mixStatus === "rendering"}
          previewDisabled={!canRender || mixStatus === "rendering"}
          previewSeconds={previewSeconds}
          previewOptions={PREVIEW_OPTIONS}
          onPreviewSecondsChange={handlePreviewSecondsChange}
          onPreviewReset={handlePreviewReset}
          previewStartSeconds={previewStartSeconds}
          onPreviewStartChange={handlePreviewStartChange}
          outputUrl={outputUrl}
          inputUrl={inputUrl}
          fullInputUrl={fullInputUrl}
          status={mixStatus}
          error={mixError}
          outputKind={outputKind}
          outputPreviewSeconds={outputPreviewSeconds}
          renderMode={renderMode}
          renderElapsedSeconds={mixElapsedSeconds}
          renderProgress={mixProgress}
          renderChunksDone={mixChunksDone}
          renderChunksTotal={mixChunksTotal}
          renderEtaSeconds={mixEtaSeconds}
          onCancel={handleCancelMix}
          onRestart={canRender ? handleRestartMix : undefined}
        />
      </section>
    </div>
  );
}
