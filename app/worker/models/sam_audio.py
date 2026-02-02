from __future__ import annotations

import logging
import os
import sys
import threading
import time
import types

import numpy as np

from app.core.audio_io import resample_audio

logger = logging.getLogger("uvicorn.error")

_TORCH = None
_SAM_AUDIO_CLASS = None
_SAM_AUDIO_PROCESSOR_CLASS = None
_SAM_AUDIO_MODEL = None
_SAM_AUDIO_PROCESSOR = None
_SAM_AUDIO_DEVICE: str | None = None
_SAM_AUDIO_MODEL_ID: str | None = None
_MODEL_LOCK = threading.Lock()


def _ensure_xformers_stub() -> None:
    try:
        import xformers.ops  # noqa: F401
    except Exception:
        pass
    else:
        return

    try:
        import torch
    except Exception:
        return

    ops = types.ModuleType("xformers.ops")

    class AttentionBias:
        pass

    def memory_efficient_attention(xq, xk, xv, attn_bias=None):
        xq_t = xq.transpose(1, 2)
        xk_t = xk.transpose(1, 2)
        xv_t = xv.transpose(1, 2)
        output = torch.nn.functional.scaled_dot_product_attention(xq_t, xk_t, xv_t)
        return output.transpose(1, 2).contiguous()

    ops.AttentionBias = AttentionBias
    ops.fmha = types.SimpleNamespace(memory_efficient_attention=memory_efficient_attention)

    pkg = types.ModuleType("xformers")
    pkg.ops = ops
    sys.modules.setdefault("xformers", pkg)
    sys.modules.setdefault("xformers.ops", ops)


def _lazy_import_torch():
    global _TORCH
    if _TORCH is None:
        try:
            import torch
        except ModuleNotFoundError:
            _TORCH = False
        else:
            _TORCH = torch
    if _TORCH is False:
        return None
    return _TORCH


def _lazy_import_sam_audio():
    global _SAM_AUDIO_CLASS, _SAM_AUDIO_PROCESSOR_CLASS
    if _SAM_AUDIO_CLASS is None:
        try:
            _ensure_xformers_stub()
            from sam_audio import SAMAudio, SAMAudioProcessor
        except ModuleNotFoundError:
            _SAM_AUDIO_CLASS = False
            _SAM_AUDIO_PROCESSOR_CLASS = False
        else:
            _SAM_AUDIO_CLASS = SAMAudio
            _SAM_AUDIO_PROCESSOR_CLASS = SAMAudioProcessor
    if _SAM_AUDIO_CLASS is False or _SAM_AUDIO_PROCESSOR_CLASS is False:
        return None, None
    return _SAM_AUDIO_CLASS, _SAM_AUDIO_PROCESSOR_CLASS


def _resolve_sam_audio_device(torch, override: str | None = None) -> str:
    raw = override if override is not None else _env_str("SAM_AUDIO_DEVICE", "auto")
    device = raw.strip().lower()
    if device == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
    return device


def _ensure_hf_token_env() -> None:
    token = _env_optional("HF_TOKEN")
    if token and not _env_optional("HUGGINGFACE_HUB_TOKEN"):
        os.environ["HUGGINGFACE_HUB_TOKEN"] = token


def _sam_audio_model_kwargs() -> dict[str, object]:
    model_kwargs: dict[str, object] = {}
    if _env_flag("SAM_AUDIO_DISABLE_RANKERS", True):
        model_kwargs["text_ranker"] = None
        model_kwargs["visual_ranker"] = None
    if _env_flag("SAM_AUDIO_DISABLE_SPAN_PREDICTOR", True):
        model_kwargs["span_predictor"] = None
    return model_kwargs


def _load_sam_audio_model(model_id: str, device_override: str | None = None):
    global _SAM_AUDIO_MODEL, _SAM_AUDIO_PROCESSOR, _SAM_AUDIO_DEVICE, _SAM_AUDIO_MODEL_ID
    sam_audio_class, sam_audio_processor_class = _lazy_import_sam_audio()
    if sam_audio_class is None or sam_audio_processor_class is None:
        return None, None, None
    torch = _lazy_import_torch()
    if torch is None:
        return None, None, None
    device = _resolve_sam_audio_device(torch, override=device_override)
    if (
        _SAM_AUDIO_MODEL is not None
        and _SAM_AUDIO_MODEL_ID == model_id
        and _SAM_AUDIO_DEVICE == device
    ):
        return _SAM_AUDIO_MODEL, _SAM_AUDIO_PROCESSOR, _SAM_AUDIO_DEVICE
    with _MODEL_LOCK:
        if (
            _SAM_AUDIO_MODEL is not None
            and _SAM_AUDIO_MODEL_ID == model_id
            and _SAM_AUDIO_DEVICE == device
        ):
            return _SAM_AUDIO_MODEL, _SAM_AUDIO_PROCESSOR, _SAM_AUDIO_DEVICE
        _ensure_hf_token_env()
        model_kwargs = _sam_audio_model_kwargs()
        load_start = time.time()
        logger.info("SAM-Audio load start (device=%s, model=%s)", device, model_id)
        model = sam_audio_class.from_pretrained(model_id, **model_kwargs)
        processor = sam_audio_processor_class.from_pretrained(model_id)
        model = model.eval().to(device)
        _SAM_AUDIO_MODEL = model
        _SAM_AUDIO_PROCESSOR = processor
        _SAM_AUDIO_DEVICE = device
        _SAM_AUDIO_MODEL_ID = model_id
        logger.info(
            "SAM-Audio load done (device=%s, seconds=%.1f)",
            device,
            time.time() - load_start,
        )
        logger.info("SAM-Audio device: %s (model: %s)", device, model_id)
        return _SAM_AUDIO_MODEL, _SAM_AUDIO_PROCESSOR, _SAM_AUDIO_DEVICE


def _match_length(audio: np.ndarray, target_len: int) -> np.ndarray:
    if audio.shape[0] > target_len:
        return audio[:target_len]
    if audio.shape[0] < target_len:
        pad = target_len - audio.shape[0]
        return np.pad(audio, (0, pad), mode="constant")
    return audio


def _env_optional(name: str) -> str | None:
    raw = os.getenv(name)
    if raw is None:
        return None
    return raw.strip()


def _env_str(name: str, default: str) -> str:
    raw = _env_optional(name)
    return raw if raw is not None else default


def _env_flag(name: str, default: bool = False) -> bool:
    raw = _env_optional(name)
    if raw is None:
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = _env_optional(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _device_fallback_enabled() -> bool:
    fallback = _env_optional("SAM_AUDIO_DEVICE_FALLBACK")
    if fallback is not None:
        return _env_flag("SAM_AUDIO_DEVICE_FALLBACK", True)
    return _env_flag("SAM_AUDIO_MPS_FALLBACK", True)


def _is_mps_oom(exc: RuntimeError) -> bool:
    message = str(exc).lower()
    return "mps backend out of memory" in message or (
        "mps" in message and "out of memory" in message
    )


def _is_cuda_oom(exc: RuntimeError) -> bool:
    message = str(exc).lower()
    return "cuda out of memory" in message or ("cuda" in message and "out of memory" in message)


def _is_device_oom(exc: RuntimeError, device: str) -> bool:
    if device == "mps":
        return _is_mps_oom(exc)
    if device == "cuda":
        return _is_cuda_oom(exc)
    return False


def _is_channel_mismatch(exc: RuntimeError) -> bool:
    message = str(exc).lower()
    return "expected input" in message and "channels" in message and "but got" in message


def _should_fallback_to_cpu(device: str, exc: RuntimeError) -> bool:
    if device not in {"mps", "cuda"}:
        return False
    if not _device_fallback_enabled():
        return False
    return _is_device_oom(exc, device) or _is_channel_mismatch(exc)


def _clear_mps_cache(torch) -> None:
    mps = getattr(torch, "mps", None)
    if mps is None:
        return
    empty_cache = getattr(mps, "empty_cache", None)
    if callable(empty_cache):
        empty_cache()


def _clear_cuda_cache(torch) -> None:
    cuda = getattr(torch, "cuda", None)
    if cuda is None:
        return
    empty_cache = getattr(cuda, "empty_cache", None)
    if callable(empty_cache):
        empty_cache()


def _clear_device_cache(torch, device: str) -> None:
    if device == "mps":
        _clear_mps_cache(torch)
    elif device == "cuda":
        _clear_cuda_cache(torch)


def _log_separation_done(device: str, fallback_from: str) -> None:
    logger.info(
        "SAM-Audio separation done (device=%s, fallback_from=%s)",
        device,
        fallback_from,
    )


def _inference_options() -> tuple[bool, int]:
    predict_spans = _env_flag("SAM_AUDIO_PREDICT_SPANS", False)
    reranking_candidates = max(1, _env_int("SAM_AUDIO_RERANKING_CANDIDATES", 1))
    return predict_spans, reranking_candidates


def _run_sam_audio_inference(
    audio: np.ndarray,
    sr: int,
    prompt: str,
    model,
    processor,
    device: str,
    torch,
) -> tuple[np.ndarray, np.ndarray]:
    audio_np = np.ascontiguousarray(audio, dtype=np.float32)
    target_sr = int(getattr(processor, "audio_sampling_rate", sr))
    if sr != target_sr:
        audio_np = resample_audio(audio_np, sr, target_sr)
    waveform = torch.as_tensor(audio_np, dtype=torch.float32)
    if waveform.ndim == 1:
        waveform = waveform.unsqueeze(0)
    elif waveform.ndim == 2 and waveform.shape[0] > waveform.shape[1]:
        waveform = waveform.transpose(0, 1)
    if waveform.ndim != 2:
        raise RuntimeError(f"SAM-Audio expects 2D waveform, got shape={tuple(waveform.shape)}")
    waveform = waveform.contiguous()
    batch = processor(descriptions=[prompt], audios=[waveform]).to(device)
    predict_spans, reranking_candidates = _inference_options()
    with torch.inference_mode():
        result = model.separate(
            batch,
            predict_spans=predict_spans,
            reranking_candidates=reranking_candidates,
        )
    target = result.target[0]
    residual = result.residual[0]
    if target.ndim > 1:
        target = target.mean(dim=0)
    if residual.ndim > 1:
        residual = residual.mean(dim=0)
    target_np = target.detach().cpu().numpy().astype(np.float32, copy=False)
    residual_np = residual.detach().cpu().numpy().astype(np.float32, copy=False)
    if sr != target_sr:
        target_np = resample_audio(target_np, target_sr, sr)
        residual_np = resample_audio(residual_np, target_sr, sr)
    target_np = _match_length(target_np, audio.shape[0])
    residual_np = _match_length(residual_np, audio.shape[0])
    return target_np, residual_np


def _separate_sam_audio(audio: np.ndarray, sr: int, prompt: str) -> tuple[np.ndarray, np.ndarray]:
    model_id = _env_str("MODEL_SAM_AUDIO_ID", "facebook/sam-audio-small")
    model, processor, device = _load_sam_audio_model(model_id)
    if model is None or processor is None or device is None:
        raise RuntimeError(
            "SAM-Audio is not installed. Install from "
            "https://github.com/facebookresearch/sam-audio and ensure dependencies are available."
        )
    torch = _lazy_import_torch()
    if torch is None:
        raise RuntimeError("PyTorch is required for SAM-Audio separation.")
    fallback_used = False
    initial_device = device
    try:
        result = _run_sam_audio_inference(audio, sr, prompt, model, processor, device, torch)
    except RuntimeError as exc:
        if _should_fallback_to_cpu(device, exc):
            if _is_device_oom(exc, device):
                reason = "OOM"
            elif _is_channel_mismatch(exc):
                reason = "shape mismatch"
            else:
                reason = "runtime error"
            logger.warning(
                "SAM-Audio %s %s. Falling back to CPU for this run. error=%s",
                device,
                reason,
                exc,
            )
            _clear_device_cache(torch, device)
            model, processor, device = _load_sam_audio_model(model_id, device_override="cpu")
            if model is None or processor is None or device is None:
                raise exc
            result = _run_sam_audio_inference(audio, sr, prompt, model, processor, device, torch)
            fallback_used = True
        else:
            raise
    _log_separation_done(device, initial_device if fallback_used else "none")
    return result


def separate_prompt(audio: np.ndarray, sr: int, prompt: str) -> tuple[np.ndarray, np.ndarray]:
    if audio.size == 0:
        return audio, audio
    if not prompt.strip():
        return np.zeros_like(audio), audio

    return _separate_sam_audio(audio, sr, prompt)
