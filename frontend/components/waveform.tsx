"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.js";

import type { CandidateSegment } from "@/lib/types";

type WaveformSegment = CandidateSegment & { label: string };
type WaveformSegmentItem = WaveformSegment & {
  hue: number;
  showLabel: boolean;
  regionId: string;
};

type WaveformPanelProps = {
  audioUrl?: string | null;
  durationSeconds?: number | null;
  segments?: WaveformSegment[];
  previewStartSeconds?: number;
  previewSeconds?: number;
  onSelectSegment?: (label: string, segment: CandidateSegment) => void;
  onPreviewRangeChange?: (start: number, end: number) => void;
  message?: string;
};

const DEFAULT_ZOOM = 90;
const ZOOM_MIN = 16;
const ZOOM_MAX = 400;
const ZOOM_STEP = 3;
const ZOOM_WHEEL_DIVISOR = 30;
const PREVIEW_LANE_RATIO = 0.28;
const LANE_GAP_RATIO = 0.06;
const RULER_HEIGHT = 26;
const RULER_TICK_TARGET_PX = 80;
const RULER_EDGE_THRESHOLD = 2;
const MIN_WAVE_HEIGHT = 80;
const DEFAULT_WAVE_HEIGHT = 140;
const SNAP_THRESHOLD_SECONDS = 0.2;
const SEGMENT_MIN_LENGTH = 0.5;
const SNAP_EPSILON = 0.002;

const formatDuration = (value: number) => {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const formatTimestamp = (value: number) => {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  const secondsLabel = seconds.toFixed(1).padStart(4, "0");
  return `${minutes}:${secondsLabel}`;
};

const hashLabel = (label: string) =>
  label.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);

const toTestId = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const segmentKey = (value: number) => String(Math.round(value * 1000));

const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

const makeSegmentBaseId = (label: string, start: number, end: number) =>
  `segment-${toTestId(label)}-${segmentKey(start)}-${segmentKey(end)}`;

const buildSegmentIds = (segments: WaveformSegment[]) => {
  const counts = new Map<string, number>();
  return segments.map((segment) => {
    const baseId = makeSegmentBaseId(segment.label, segment.t0, segment.t1);
    const count = counts.get(baseId) ?? 0;
    counts.set(baseId, count + 1);
    return count === 0 ? baseId : `${baseId}-${count}`;
  });
};

const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

const selectStep = (target: number) =>
  RULER_STEPS.find((step) => step >= target) ?? RULER_STEPS[RULER_STEPS.length - 1];

export function WaveformPanel({
  audioUrl,
  durationSeconds,
  segments = [],
  previewStartSeconds = 0,
  previewSeconds = 0,
  onSelectSegment,
  onPreviewRangeChange,
  message,
}: WaveformPanelProps) {
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const onSelectSegmentRef = useRef<WaveformPanelProps["onSelectSegment"]>(null);
  const onPreviewRangeChangeRef = useRef<
    WaveformPanelProps["onPreviewRangeChange"]
  >(null);
  const zoomRef = useRef(DEFAULT_ZOOM);
  const previewTrackRef = useRef<HTMLDivElement | null>(null);
  const previewTrackInnerRef = useRef<HTMLDivElement | null>(null);
  const previewGuidesInnerRef = useRef<HTMLDivElement | null>(null);
  const rulerInnerRef = useRef<HTMLDivElement | null>(null);
  const interactionModeRef = useRef<"seek" | "pan">("seek");
  const playheadInnerRef = useRef<HTMLDivElement | null>(null);
  const segmentLookupRef = useRef(
    new Map<string, { label: string; segment: CandidateSegment }>(),
  );
  const segmentOverridesRef = useRef(new Map<string, CandidateSegment>());
  const segmentUpdateLocksRef = useRef(new Map<string, { start: number; end: number }>());
  const segmentItemsRef = useRef<WaveformSegmentItem[]>([]);
  const panRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const previewDragRef = useRef<{
    mode: "move" | "resize-start" | "resize-end";
    startX: number;
    start: number;
    end: number;
  } | null>(null);
  const seekDragRef = useRef(false);

  const [segmentOverridesVersion, setSegmentOverridesVersion] = useState(0);
  const [segmentOverridesSnapshot, setSegmentOverridesSnapshot] = useState<
    Map<string, CandidateSegment>
  >(new Map());
  const [duration, setDuration] = useState<number | null>(durationSeconds ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [interactionMode, setInteractionMode] = useState<"seek" | "pan">("seek");
  const [isPanning, setIsPanning] = useState(false);
  const [isPreviewDragging, setIsPreviewDragging] = useState(false);
  const [previewDraft, setPreviewDraft] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [scrollIndicator, setScrollIndicator] = useState({
    visible: false,
    left: 0,
    width: 100,
  });

  useEffect(() => {
    setDuration(durationSeconds ?? null);
  }, [durationSeconds]);

  useEffect(() => {
    onSelectSegmentRef.current = onSelectSegment;
  }, [onSelectSegment]);

  useEffect(() => {
    onPreviewRangeChangeRef.current = onPreviewRangeChange;
  }, [onPreviewRangeChange]);

  function resolveScrollContainer(wavesurfer?: WaveSurfer | null) {
    if (scrollContainerRef.current) {
      return scrollContainerRef.current;
    }
    const wrapper = (wavesurfer ?? wavesurferRef.current)?.getWrapper?.();
    const scrollContainer = wrapper?.parentElement as HTMLDivElement | null;
    if (scrollContainer) {
      scrollContainerRef.current = scrollContainer;
    }
    return scrollContainer;
  }

  function updateOverlayTracks(scrollContainer?: HTMLDivElement | null) {
    const inner = previewTrackInnerRef.current;
    const guides = previewGuidesInnerRef.current;
    const ruler = rulerInnerRef.current;
    const playhead = playheadInnerRef.current;
    if (!inner && !guides && !ruler && !playhead) {
      return;
    }
    const wavesurfer = wavesurferRef.current;
    const wrapper = wavesurfer?.getWrapper();
    const scrollLeft = wavesurfer?.getScroll?.() ?? 0;
    const scrollTarget = scrollContainer ?? resolveScrollContainer();
    const totalWidth = Math.max(
      wrapper?.scrollWidth || 0,
      scrollTarget?.scrollWidth || 0,
      wrapper?.offsetWidth || 0,
      scrollTarget?.clientWidth || 0,
      wavesurfer?.getWidth?.() || 0,
    );
    if (!totalWidth) {
      return;
    }
    const viewportWidth =
      scrollTarget?.clientWidth ?? wavesurfer?.getWidth?.() ?? totalWidth;
    const clampedWidth = Math.max(viewportWidth, totalWidth);
    const effectiveScrollLeft = scrollTarget ? scrollTarget.scrollLeft : scrollLeft;
    if (inner) {
      inner.style.width = `${clampedWidth}px`;
      inner.style.transform = `translateX(${-effectiveScrollLeft}px)`;
    }
    if (guides) {
      guides.style.width = `${clampedWidth}px`;
      guides.style.transform = `translateX(${-effectiveScrollLeft}px)`;
    }
    if (ruler) {
      ruler.style.width = `${clampedWidth}px`;
      ruler.style.transform = `translateX(${-effectiveScrollLeft}px)`;
    }
    if (playhead) {
      playhead.style.width = `${clampedWidth}px`;
      playhead.style.transform = `translateX(${-effectiveScrollLeft}px)`;
    }
  }

  function updateScrollIndicator() {
    const scrollContainer = resolveScrollContainer();
    updateOverlayTracks(scrollContainer);
    if (!scrollContainer) {
      setScrollIndicator((prev) =>
        prev.visible ? { ...prev, visible: false, left: 0, width: 100 } : prev,
      );
      return;
    }
    const { scrollWidth, clientWidth, scrollLeft } = scrollContainer;
    if (scrollWidth <= clientWidth + 1) {
      setScrollIndicator((prev) =>
        prev.visible ? { ...prev, visible: false, left: 0, width: 100 } : prev,
      );
      return;
    }
    const maxScroll = Math.max(1, scrollWidth - clientWidth);
    const widthPct = Math.min(100, Math.max(8, (clientWidth / scrollWidth) * 100));
    const leftPct = (scrollLeft / maxScroll) * (100 - widthPct);
    setScrollIndicator((prev) => {
      const next = { visible: true, left: leftPct, width: widthPct };
      if (
        prev.visible &&
        Math.abs(prev.left - next.left) < 0.5 &&
        Math.abs(prev.width - next.width) < 0.5
      ) {
        return prev;
      }
      return next;
    });
  }

  function seekFromClientX(clientX: number) {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer) {
      return;
    }
    const durationValue = wavesurfer.getDuration() || duration || durationSeconds || 0;
    if (!durationValue) {
      return;
    }
    const wrapper = wavesurfer.getWrapper();
    const scrollTarget = resolveScrollContainer();
    const totalWidth = Math.max(
      wrapper?.scrollWidth || 0,
      scrollTarget?.scrollWidth || 0,
      wrapper?.offsetWidth || 0,
      scrollTarget?.clientWidth || 0,
    );
    if (!totalWidth) {
      return;
    }
    const baseRect =
      scrollTarget?.getBoundingClientRect() ?? wrapper?.getBoundingClientRect();
    if (!baseRect) {
      return;
    }
    const scrollLeft = scrollTarget?.scrollLeft ?? wavesurfer.getScroll?.() ?? 0;
    const offsetX = clientX - baseRect.left + scrollLeft;
    const ratio = Math.max(0, Math.min(1, offsetX / totalWidth));
    wavesurfer.seekTo(ratio);
    setPlayheadTime(ratio * durationValue);
  }

  useEffect(() => {
    interactionModeRef.current = interactionMode;
  }, [interactionMode]);

  useEffect(() => {
    setSegmentOverridesSnapshot(new Map(segmentOverridesRef.current));
  }, [segmentOverridesVersion]);

  useEffect(() => {
    const validIds = new Set(
      buildSegmentIds(segments.filter((segment) => segment.t1 > segment.t0)),
    );
    let changed = false;
    segmentOverridesRef.current.forEach((_segment, key) => {
      if (!validIds.has(key)) {
        segmentOverridesRef.current.delete(key);
        changed = true;
      }
    });
    if (changed) {
      setSegmentOverridesVersion((prev) => prev + 1);
    }
  }, [segments]);

  useEffect(() => {
    zoomRef.current = zoom;
    if (isReady && wavesurferRef.current) {
      const durationValue = wavesurferRef.current.getDuration();
      if (durationValue > 0) {
        try {
          wavesurferRef.current.zoom(zoom);
        } catch {
          // ignore zoom errors before audio loads
        }
      }
      window.requestAnimationFrame(() => {
        updateScrollIndicator();
      });
    }
  }, [zoom, isReady]);

  useEffect(() => {
    const target = waveformRef.current;
    if (!target) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      const delta = Math.abs(event.deltaY);
      const multiplier = Math.max(1, Math.round(delta / ZOOM_WHEEL_DIVISOR));
      const step = ZOOM_STEP * multiplier;
      setZoom((prev) => clampZoom(prev + direction * step));
    };
    target.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      target.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    const wavesurfer = wavesurferRef.current;
    const regions = regionsRef.current;
    if (!wavesurfer || !regions) {
      return;
    }
    if (interactionMode === "pan") {
      wavesurfer.setOptions({ dragToSeek: false, interact: false });
      if (previewDragRef.current) {
        previewDragRef.current = null;
        setPreviewDraft(null);
      }
      setIsPreviewDragging(false);
      return;
    }
    wavesurfer.setOptions({ dragToSeek: true, interact: true });
  }, [interactionMode, isReady]);

  useEffect(() => {
    if (!isPreviewDragging) {
      return;
    }
    updateOverlayTracks();
  }, [isPreviewDragging]);

  useEffect(() => {
    if (!audioUrl || !waveformRef.current) {
      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
      regionsRef.current = null;
      scrollContainerRef.current = null;
      setScrollIndicator({ visible: false, left: 0, width: 100 });
      setIsReady(false);
      setLoading(false);
      setError(null);
      return;
    }

    wavesurferRef.current?.destroy();
    setLoading(true);
    setError(null);
    setIsReady(false);
    setIsPlaying(false);
    setPlayheadTime(0);

    const laneContainer = waveformRef.current.parentElement;
    const containerHeight =
      (laneContainer?.clientHeight ?? waveformRef.current.clientHeight) || 0;
    const previewLaneHeight =
      containerHeight > 0 ? containerHeight * PREVIEW_LANE_RATIO : 0;
    const laneGap = containerHeight > 0 ? containerHeight * LANE_GAP_RATIO : 0;
    const lanePadding = previewLaneHeight + laneGap + RULER_HEIGHT;
    const waveHeight =
      containerHeight > 0
        ? Math.max(MIN_WAVE_HEIGHT, Math.round(containerHeight - lanePadding))
        : DEFAULT_WAVE_HEIGHT;
    if (laneContainer) {
      laneContainer.style.setProperty("--ruler-height", `${RULER_HEIGHT}px`);
      laneContainer.style.setProperty(
        "--preview-lane-height",
        `${previewLaneHeight}px`,
      );
      laneContainer.style.setProperty("--lane-gap", `${laneGap}px`);
    }

    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      height: waveHeight,
      barWidth: 2,
      barGap: 1,
      barRadius: 999,
      waveColor: "rgba(31, 28, 24, 0.35)",
      progressColor: "rgba(31, 28, 24, 0.75)",
      cursorColor: "transparent",
      cursorWidth: 0,
      normalize: true,
      dragToSeek: true,
      minPxPerSec: zoomRef.current,
      autoScroll: true,
      autoCenter: false,
      hideScrollbar: false,
    });

    const regions = wavesurfer.registerPlugin(RegionsPlugin.create());
    const handlePlayheadUpdate = (value?: number) => {
      if (typeof value === "number") {
        setPlayheadTime(value);
      } else {
        setPlayheadTime(wavesurfer.getCurrentTime());
      }
    };

    wavesurfer.on("ready", () => {
      setDuration(wavesurfer.getDuration());
      setLoading(false);
      setIsReady(true);
      setPlayheadTime(0);
      resolveScrollContainer(wavesurfer);
      updateScrollIndicator();
      if (wavesurfer.getDuration() > 0) {
        try {
          wavesurfer.zoom(zoomRef.current);
        } catch {
          // ignore zoom errors before audio loads
        }
      }
      updateOverlayTracks();
    });
    wavesurfer.on("scroll", () => {
      updateScrollIndicator();
    });
    wavesurfer.on("zoom", () => {
      updateScrollIndicator();
    });
    wavesurfer.on("error", (err) => {
      setError(err?.message ?? "Unable to load waveform");
      setLoading(false);
      setIsReady(false);
    });
    wavesurfer.on("play", () => setIsPlaying(true));
    wavesurfer.on("pause", () => setIsPlaying(false));
    wavesurfer.on("finish", () => {
      setIsPlaying(false);
      setPlayheadTime(wavesurfer.getDuration());
    });
    wavesurfer.on("timeupdate", handlePlayheadUpdate);
    wavesurfer.on("seeking", handlePlayheadUpdate);
    wavesurfer.on("interaction", handlePlayheadUpdate);

    regions.on("region-clicked", (region, event) => {
      const meta = segmentLookupRef.current.get(region.id);
      if (!meta) {
        return;
      }
      event.stopPropagation();
      if (interactionModeRef.current === "seek") {
        seekFromClientX(event.clientX);
      }
      onSelectSegmentRef.current?.(meta.label, meta.segment);
    });

    wavesurfer.load(audioUrl).catch((err) => {
      setError(err instanceof Error ? err.message : "Unable to load waveform");
      setLoading(false);
      setIsReady(false);
    });

    wavesurferRef.current = wavesurfer;
    regionsRef.current = regions;

    return () => {
      wavesurfer.destroy();
      if (wavesurferRef.current === wavesurfer) {
        wavesurferRef.current = null;
        regionsRef.current = null;
        scrollContainerRef.current = null;
      }
    };
  }, [audioUrl]);

  const startPan = (clientX: number) => {
    if (interactionMode !== "pan") {
      return;
    }
    const scrollContainer = resolveScrollContainer();
    if (!scrollContainer) {
      return;
    }
    panRef.current = {
      active: true,
      startX: clientX,
      scrollLeft: scrollContainer.scrollLeft,
    };
    setIsPanning(true);
  };

  const movePan = (clientX: number) => {
    if (!panRef.current.active || interactionMode !== "pan") {
      return;
    }
    const scrollContainer = resolveScrollContainer();
    if (!scrollContainer) {
      return;
    }
    const delta = clientX - panRef.current.startX;
    const nextScroll = Math.max(0, panRef.current.scrollLeft - delta);
    scrollContainer.scrollLeft = nextScroll;
    updateScrollIndicator();
  };

  const endPan = () => {
    if (!panRef.current.active) {
      return;
    }
    panRef.current.active = false;
    setIsPanning(false);
  };

  const segmentItems = useMemo<WaveformSegmentItem[]>(() => {
    const filteredSegments = segments.filter((segment) => segment.t1 > segment.t0);
    const segmentIds = buildSegmentIds(filteredSegments);
    const baseItems = filteredSegments.map((segment, index) => {
      const regionId = segmentIds[index];
      const override = segmentOverridesSnapshot.get(regionId);
      return {
        ...segment,
        t0: override?.t0 ?? segment.t0,
        t1: override?.t1 ?? segment.t1,
        score: Number.isFinite(segment.score) ? segment.score : 0,
        hue: hashLabel(segment.label) % 360,
        regionId,
      };
    });
    if (!baseItems.length) {
      return [];
    }
    const sorted = baseItems
      .map((segment, index) => ({ ...segment, index }))
      .sort((a, b) => {
        if (a.t0 !== b.t0) {
          return a.t0 - b.t0;
        }
        return a.t1 - b.t1;
      });
    const showLabel = new Set<number>();
    let clusterEnd = -Infinity;
    let bestIndex: number | null = null;
    let bestScore = -Infinity;
    sorted.forEach((segment) => {
      if (segment.t0 <= clusterEnd) {
        clusterEnd = Math.max(clusterEnd, segment.t1);
        if (segment.score > bestScore) {
          bestScore = segment.score;
          bestIndex = segment.index;
        }
        return;
      }
      if (bestIndex !== null) {
        showLabel.add(bestIndex);
      }
      clusterEnd = segment.t1;
      bestScore = segment.score;
      bestIndex = segment.index;
    });
    if (bestIndex !== null) {
      showLabel.add(bestIndex);
    }
    return baseItems.map((segment, index) => ({
      ...segment,
      showLabel: showLabel.has(index),
    }));
  }, [segments, segmentOverridesSnapshot]);

  useEffect(() => {
    segmentItemsRef.current = segmentItems;
  }, [segmentItems]);

  const snapValue = (value: number, points: number[], threshold: number) => {
    let nearest = value;
    let smallest = threshold;
    points.forEach((point) => {
      const delta = Math.abs(point - value);
      if (delta <= smallest) {
        smallest = delta;
        nearest = point;
      }
    });
    return nearest;
  };

  const clampSegment = (start: number, end: number, maxDuration: number) => {
    let nextStart = Math.max(0, Math.min(start, maxDuration));
    let nextEnd = Math.max(0, Math.min(end, maxDuration));
    if (nextEnd - nextStart < SEGMENT_MIN_LENGTH) {
      const midpoint = (nextStart + nextEnd) / 2;
      nextStart = Math.max(
        0,
        Math.min(midpoint - SEGMENT_MIN_LENGTH / 2, maxDuration - SEGMENT_MIN_LENGTH),
      );
      nextEnd = Math.min(maxDuration, nextStart + SEGMENT_MIN_LENGTH);
    }
    return { start: nextStart, end: nextEnd };
  };

  const buildSnapPoints = (excludeId: string, maxDuration: number) => {
    const points = new Set<number>([0, maxDuration]);
    segmentItemsRef.current.forEach((segment) => {
      if (segment.regionId === excludeId) {
        return;
      }
      points.add(segment.t0);
      points.add(segment.t1);
    });
    return Array.from(points.values());
  };

  const applySegmentUpdate = (region: Region) => {
    const meta = segmentLookupRef.current.get(region.id);
    if (!meta) {
      return;
    }
    const durationValue =
      wavesurferRef.current?.getDuration() || duration || durationSeconds || 0;
    if (!durationValue) {
      return;
    }
    const lock = segmentUpdateLocksRef.current.get(region.id);
    if (
      lock &&
      Math.abs(lock.start - region.start) < SNAP_EPSILON &&
      Math.abs(lock.end - region.end) < SNAP_EPSILON
    ) {
      segmentUpdateLocksRef.current.delete(region.id);
      return;
    }
    const snapPoints = buildSnapPoints(region.id, durationValue);
    let nextStart = snapValue(region.start, snapPoints, SNAP_THRESHOLD_SECONDS);
    let nextEnd = snapValue(region.end ?? region.start, snapPoints, SNAP_THRESHOLD_SECONDS);
    const clamped = clampSegment(nextStart, nextEnd, durationValue);
    nextStart = clamped.start;
    nextEnd = clamped.end;
    const changed =
      Math.abs(nextStart - region.start) > SNAP_EPSILON ||
      Math.abs(nextEnd - (region.end ?? region.start)) > SNAP_EPSILON;
    if (changed) {
      segmentUpdateLocksRef.current.set(region.id, { start: nextStart, end: nextEnd });
      region.setOptions({ start: nextStart, end: nextEnd });
    }
    const updatedSegment = { t0: nextStart, t1: nextEnd, score: meta.segment.score };
    segmentLookupRef.current.set(region.id, {
      label: meta.label,
      segment: updatedSegment,
    });
    segmentOverridesRef.current.set(region.id, updatedSegment);
    setSegmentOverridesVersion((prev) => prev + 1);
    if (region.element) {
      region.element.setAttribute("data-segment-start", nextStart.toFixed(1));
      region.element.setAttribute("data-segment-end", nextEnd.toFixed(1));
    }
    onSelectSegmentRef.current?.(meta.label, updatedSegment);
  };

  const shouldIgnoreSeekTarget = (target: HTMLElement | null) => {
    if (!target) {
      return false;
    }
    return Boolean(
      target.closest(".waveform-preview-handle") ||
        target.closest(".waveform-preview-range") ||
        target.closest(".waveform-region"),
    );
  };

  const handleSeekPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (interactionModeRef.current !== "seek") {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (shouldIgnoreSeekTarget(event.target as HTMLElement)) {
      return;
    }
    seekDragRef.current = true;
    seekFromClientX(event.clientX);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSeekPointerMoveCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!seekDragRef.current || interactionModeRef.current !== "seek") {
      return;
    }
    seekFromClientX(event.clientX);
  };

  const handleSeekPointerUpCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!seekDragRef.current) {
      return;
    }
    seekDragRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    if (!isReady || !regionsRef.current || !wavesurferRef.current) {
      return;
    }
    const regions = regionsRef.current;
    const durationValue = wavesurferRef.current.getDuration() || durationSeconds || 0;
    regions.clearRegions();
    segmentLookupRef.current.clear();

    segmentItems.forEach((segment) => {
      if (!durationValue) {
        return;
      }
      const start = Math.max(0, Math.min(segment.t0, durationValue));
      const end = Math.max(start, Math.min(segment.t1, durationValue));
      if (end <= start) {
        return;
      }
      const regionId = segment.regionId;
      const region = regions.addRegion({
        id: regionId,
        start,
        end,
        drag: true,
        resize: true,
        color: `hsla(${segment.hue}, 70%, 72%, 0.28)`,
      });
      if (segment.showLabel) {
        const labelNode = document.createElement("span");
        labelNode.className = "waveform-region-label";
        labelNode.textContent = segment.label;
        region.setContent(labelNode);
      }
      region.element?.classList.add("waveform-region", "waveform-region-editable");
      region.element?.setAttribute("data-testid", `waveform-${regionId}`);
      region.element?.setAttribute("data-segment-label", segment.label);
      region.element?.setAttribute("data-segment-start", segment.t0.toFixed(1));
      region.element?.setAttribute("data-segment-end", segment.t1.toFixed(1));
      region.element?.style.setProperty(
        "border-color",
        `hsla(${segment.hue}, 60%, 45%, 0.7)`,
      );
      region.element?.style.setProperty(
        "z-index",
        String(10 + Math.round(segment.t0 * 10)),
      );
      segmentLookupRef.current.set(regionId, {
        label: segment.label,
        segment: { t0: segment.t0, t1: segment.t1, score: segment.score },
      });
      region.on("update-end", () => {
        applySegmentUpdate(region);
      });
    });
  }, [
    segmentItems,
    durationSeconds,
    isReady,
  ]);

  useEffect(() => {
    if (previewDragRef.current) {
      return;
    }
    if (
      previewDraft &&
      Math.abs(previewDraft.start - previewStartSeconds) < 0.05 &&
      Math.abs(previewDraft.end - (previewStartSeconds + previewSeconds)) < 0.05
    ) {
      setPreviewDraft(null);
    }
  }, [previewStartSeconds, previewSeconds, previewDraft]);

  const clampPreview = (start: number, end: number, maxDuration: number) => {
    const minLength = 0.5;
    let nextStart = Math.max(0, Math.min(start, maxDuration));
    let nextEnd = Math.max(0, Math.min(end, maxDuration));
    if (nextEnd - nextStart < minLength) {
      const midpoint = (nextStart + nextEnd) / 2;
      nextStart = Math.max(0, Math.min(midpoint - minLength / 2, maxDuration - minLength));
      nextEnd = Math.min(maxDuration, nextStart + minLength);
    }
    return { start: nextStart, end: nextEnd };
  };

  const handlePreviewPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    mode: "move" | "resize-start" | "resize-end",
  ) => {
    if (!previewTrackRef.current) {
      return;
    }
    const durationValue = duration ?? durationSeconds ?? 0;
    if (!durationValue) {
      return;
    }
    event.preventDefault();
    const start = previewDraft?.start ?? previewStartSeconds;
    const end = previewDraft?.end ?? previewStartSeconds + previewSeconds;
    previewDragRef.current = {
      mode,
      startX: event.clientX,
      start,
      end,
    };
    setIsPreviewDragging(true);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const handlePreviewPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!previewDragRef.current) {
      return;
    }
    const durationValue = duration ?? durationSeconds ?? 0;
    if (!durationValue) {
      return;
    }
    const { mode, startX, start, end } = previewDragRef.current;
    const scrollContainer = resolveScrollContainer();
    const wrapper = wavesurferRef.current?.getWrapper();
    const scrollWidth =
      wrapper?.scrollWidth || wrapper?.offsetWidth || scrollContainer?.scrollWidth || 0;
    const trackRect = previewTrackRef.current?.getBoundingClientRect();
    const baseWidth = scrollWidth || trackRect?.width || 0;
    if (!baseWidth) {
      return;
    }
    const deltaSeconds = ((event.clientX - startX) / baseWidth) * durationValue;
    let nextStart = start;
    let nextEnd = end;
    if (mode === "move") {
      nextStart = start + deltaSeconds;
      nextEnd = end + deltaSeconds;
    } else if (mode === "resize-start") {
      nextStart = start + deltaSeconds;
    } else {
      nextEnd = end + deltaSeconds;
    }
    const clamped = clampPreview(nextStart, nextEnd, durationValue);
    setPreviewDraft({ start: clamped.start, end: clamped.end });
  };

  const handlePreviewPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!previewDragRef.current) {
      return;
    }
    const durationValue = duration ?? durationSeconds ?? 0;
    previewDragRef.current = null;
    const finalStart = previewDraft?.start ?? previewStartSeconds;
    const finalEnd = previewDraft?.end ?? previewStartSeconds + previewSeconds;
    if (durationValue && finalEnd > finalStart) {
      onPreviewRangeChangeRef.current?.(finalStart, finalEnd);
    }
    setIsPreviewDragging(false);
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  };

  const timelineDuration = duration ?? durationSeconds ?? 0;
  const panelTag = timelineDuration
    ? `Duration ${formatDuration(timelineDuration)}`
    : "Waveform";
  const rulerTicks = useMemo(() => {
    if (!timelineDuration) {
      return [];
    }
    const targetStep = Math.max(0.5, RULER_TICK_TARGET_PX / zoom);
    let majorStep = selectStep(targetStep);
    let minorStep = majorStep / (majorStep >= 10 ? 5 : 2);
    const maxTicks = 240;
    if (timelineDuration / minorStep > maxTicks) {
      minorStep = selectStep(timelineDuration / maxTicks);
      majorStep = minorStep * 2;
    }
    const majorEvery = Math.max(1, Math.round(majorStep / minorStep));
    const labelFormatter = majorStep < 1 ? formatTimestamp : formatDuration;
    const ticks: Array<{
      time: number;
      left: number;
      major: boolean;
      label: string;
      edge: "left" | "right" | "center";
    }> = [];
    const totalTicks = Math.ceil(timelineDuration / minorStep);
    for (let index = 0; index <= totalTicks; index += 1) {
      const time = Math.min(timelineDuration, index * minorStep);
      const left = (time / timelineDuration) * 100;
      const major = index % majorEvery === 0 || index === totalTicks;
      const edge =
        left <= RULER_EDGE_THRESHOLD
          ? "left"
          : left >= 100 - RULER_EDGE_THRESHOLD
            ? "right"
            : "center";
      ticks.push({
        time,
        left,
        major,
        label: major ? labelFormatter(time) : "",
        edge,
      });
    }
    return ticks;
  }, [timelineDuration, zoom]);
  const previewBaseStart = previewDraft?.start ?? previewStartSeconds;
  const previewBaseEnd = previewDraft?.end ?? previewStartSeconds + (previewSeconds || 0);
  const previewClamped = timelineDuration
    ? clampPreview(previewBaseStart, previewBaseEnd, timelineDuration)
    : { start: previewBaseStart, end: previewBaseEnd };
  const previewStartValue = previewClamped.start;
  const previewEndValue = previewClamped.end;
  const previewDuration = Math.max(0, previewEndValue - previewStartValue);
  const showPreview = Boolean(timelineDuration) && previewDuration > 0;
  const previewLeft = timelineDuration
    ? (previewStartValue / timelineDuration) * 100
    : 0;
  const previewWidth = timelineDuration ? (previewDuration / timelineDuration) * 100 : 0;
  const showPreviewGuides = showPreview && isPreviewDragging;
  const previewGuideStart = Math.max(0, Math.min(100, previewLeft));
  const previewGuideEnd = Math.max(0, Math.min(100, previewLeft + previewWidth));
  const showPlayhead = Boolean(timelineDuration) && isReady;
  const playheadLeft = timelineDuration
    ? Math.max(0, Math.min(100, (playheadTime / timelineDuration) * 100))
    : 0;
  const playheadEdge =
    playheadLeft <= RULER_EDGE_THRESHOLD
      ? "left"
      : playheadLeft >= 100 - RULER_EDGE_THRESHOLD
        ? "right"
        : "center";
  const guideEdgeThreshold = 4;
  const guideStartEdge =
    previewGuideStart <= guideEdgeThreshold
      ? "left"
      : previewGuideStart >= 100 - guideEdgeThreshold
        ? "right"
        : "center";
  const guideEndEdge =
    previewGuideEnd <= guideEdgeThreshold
      ? "left"
      : previewGuideEnd >= 100 - guideEdgeThreshold
        ? "right"
        : "center";

  useEffect(() => {
    if (!showPlayhead) {
      return;
    }
    updateOverlayTracks();
  }, [showPlayhead]);

  const togglePlayback = () => {
    if (!wavesurferRef.current || !isReady) {
      return;
    }
    wavesurferRef.current.playPause();
  };

  return (
    <section className="panel span-12" data-testid="waveform-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Timeline</p>
          <h2 className="panel-title">Waveform and segments</h2>
        </div>
        <div className="panel-actions waveform-controls">
          <div className="waveform-mode">
            <button
              className={`ghost-button small ${interactionMode === "seek" ? "is-active" : ""}`}
              type="button"
              onClick={() => setInteractionMode("seek")}
              disabled={!isReady}
              data-testid="waveform-mode-seek"
            >
              Seek
            </button>
            <button
              className={`ghost-button small ${interactionMode === "pan" ? "is-active" : ""}`}
              type="button"
              onClick={() => setInteractionMode("pan")}
              disabled={!isReady}
              data-testid="waveform-mode-pan"
            >
              Pan
            </button>
          </div>
          <button
            className="ghost-button small"
            type="button"
            onClick={togglePlayback}
            disabled={!isReady}
            data-testid="waveform-play"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <label className="waveform-zoom">
            <span className="waveform-zoom-label">Zoom</span>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              value={zoom}
              step={1}
              onChange={(event) => setZoom(Number(event.target.value))}
              disabled={!isReady}
              data-testid="waveform-zoom"
            />
            <span className="waveform-zoom-value" data-testid="waveform-zoom-value">
              {zoom}px/s
            </span>
          </label>
          <span className="panel-tag">{panelTag}</span>
        </div>
      </div>
      <div
        className="waveform"
        onPointerDownCapture={handleSeekPointerDownCapture}
        onPointerMoveCapture={handleSeekPointerMoveCapture}
        onPointerUpCapture={handleSeekPointerUpCapture}
        onPointerCancel={handleSeekPointerUpCapture}
      >
        <div
          className="waveform-mode-indicator"
          data-testid="waveform-mode-indicator"
          data-mode={interactionMode}
        >
          {interactionMode === "seek" ? "Seek mode" : "Pan mode"}
        </div>
        <div className="waveform-ruler" data-testid="waveform-ruler">
          <div className="waveform-ruler-track">
            <div className="waveform-ruler-inner" ref={rulerInnerRef}>
              {rulerTicks.map((tick) => (
                <div
                  key={`tick-${tick.time}`}
                  className={`waveform-ruler-tick ${tick.major ? "major" : "minor"}`}
                  style={{ left: `${tick.left}%` }}
                  data-edge={tick.edge}
                >
                  {tick.major ? (
                    <span className="waveform-ruler-label">{tick.label}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        {showPlayhead ? (
          <div className="waveform-playhead-track" data-testid="waveform-playhead-track">
            <div className="waveform-playhead-inner" ref={playheadInnerRef}>
              <div
                className="waveform-playhead"
                style={{ left: `${playheadLeft}%` }}
                data-testid="waveform-playhead"
                data-edge={playheadEdge}
              >
                <span
                  className="waveform-playhead-label"
                  data-testid="waveform-playhead-label"
                >
                  {formatTimestamp(playheadTime)}
                </span>
              </div>
            </div>
          </div>
        ) : null}
        <div className="waveform-preview-lane" data-testid="preview-lane">
          <div className="waveform-preview-label">Preview</div>
          <div className="waveform-preview-track" ref={previewTrackRef}>
            <div className="waveform-preview-track-inner" ref={previewTrackInnerRef}>
              {showPreview ? (
                <div
                  className="waveform-preview-range"
                  style={{
                    left: `${previewLeft}%`,
                    width: `${previewWidth}%`,
                  }}
                  data-testid="preview-range"
                  aria-label={`Preview range ${previewStartValue.toFixed(1)}s to ${previewEndValue.toFixed(1)}s`}
                  onPointerDown={(event) => handlePreviewPointerDown(event, "move")}
                  onPointerMove={handlePreviewPointerMove}
                  onPointerUp={handlePreviewPointerUp}
                  onPointerCancel={handlePreviewPointerUp}
                >
                  <span
                    className="waveform-preview-handle start"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      handlePreviewPointerDown(event, "resize-start");
                    }}
                    onPointerMove={handlePreviewPointerMove}
                    onPointerUp={handlePreviewPointerUp}
                    onPointerCancel={handlePreviewPointerUp}
                  />
                  <span
                    className="waveform-preview-handle end"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      handlePreviewPointerDown(event, "resize-end");
                    }}
                    onPointerMove={handlePreviewPointerMove}
                    onPointerUp={handlePreviewPointerUp}
                    onPointerCancel={handlePreviewPointerUp}
                  />
                  <span className="waveform-preview-meta" data-testid="preview-range-meta">
                    <span data-testid="preview-range-start">
                      {previewStartValue.toFixed(1)}
                    </span>
                    s–
                    <span data-testid="preview-range-end">{previewEndValue.toFixed(1)}</span>s
                  </span>
                </div>
              ) : null}
            </div>
            {!showPreview ? (
              <div className="waveform-preview-empty">
                Select a segment to set preview.
              </div>
            ) : null}
          </div>
        </div>
        {showPreviewGuides ? (
          <div className="waveform-preview-guides" data-testid="preview-guides">
            <div className="waveform-preview-guides-inner" ref={previewGuidesInnerRef}>
              <div
                className="waveform-preview-guide"
                style={{ left: `${previewGuideStart}%` }}
                data-testid="preview-guide-start"
                data-edge={guideStartEdge}
              >
                <span className="waveform-preview-guide-label">
                  {previewStartValue.toFixed(1)}s
                </span>
              </div>
              <div
                className="waveform-preview-guide"
                style={{ left: `${previewGuideEnd}%` }}
                data-testid="preview-guide-end"
                data-edge={guideEndEdge}
              >
                <span className="waveform-preview-guide-label">
                  {previewEndValue.toFixed(1)}s
                </span>
              </div>
            </div>
          </div>
        ) : null}
        <div
          ref={waveformRef}
          className="waveform-canvas"
          data-testid="waveform-canvas"
          data-ready={isReady ? "true" : "false"}
          data-mode={interactionMode}
          data-panning={isPanning ? "true" : "false"}
          onMouseDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            if (interactionMode === "pan") {
              event.preventDefault();
              startPan(event.clientX);
              return;
            }
          }}
          onMouseMove={(event) => {
            if (interactionMode === "pan") {
              movePan(event.clientX);
            }
          }}
          onMouseUp={() => endPan()}
          onMouseLeave={() => endPan()}
        />
        {!isReady && loading ? (
          <div className="waveform-empty">Loading waveform...</div>
        ) : null}
        {!isReady && !loading && (error || !audioUrl) ? (
          <div className="waveform-empty">
            {error ? `Waveform unavailable: ${error}` : "Upload audio to render waveform."}
          </div>
        ) : null}
      </div>
      <div
        className="waveform-scroll-indicator"
        data-testid="waveform-scroll-indicator"
        data-visible={scrollIndicator.visible ? "true" : "false"}
      >
        <span
          className="waveform-scroll-thumb"
          data-testid="waveform-scroll-thumb"
          style={{
            width: `${scrollIndicator.width}%`,
            left: `${scrollIndicator.left}%`,
          }}
        />
      </div>
      <p className="panel-meta">
        {message ??
          "Drag to preview a region or click a segment to render an instant A/B mix."}
      </p>
    </section>
  );
}
