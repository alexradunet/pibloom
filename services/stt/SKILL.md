---
name: stt
version: 0.1.0
description: Speech-to-text via whisper.cpp server (OpenAI-compatible API)
image: ghcr.io/ggml-org/whisper.cpp:main
---

# STT Service

Local speech-to-text powered by whisper.cpp. Transcribes audio files (voice notes, recordings) via an OpenAI-compatible API. Runs on CPU.

## First-Time Setup

Download a whisper model into the volume:

```bash
podman volume create bloom-stt-models

# Download whisper base.en model (~150MB, good accuracy for English)
podman run --rm -v bloom-stt-models:/models docker.io/curlimages/curl:latest \
  -L -o /models/ggml-base.en.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
```

For multilingual support, use `ggml-base.bin` instead.

## API

### Transcribe Audio

```bash
curl -X POST http://localhost:8081/inference \
  -F "file=@/path/to/audio.ogg" \
  -F "response_format=json"
```

Response:
```json
{"text": "transcribed content here"}
```

### Health Check

```bash
curl -sf http://localhost:8081/health
```

## Service Control

```bash
systemctl --user start bloom-stt.service
systemctl --user status bloom-stt
journalctl --user -u bloom-stt -f
```

## Notes

- Model must be downloaded before first start (see setup above)
- Memory usage: ~500MB-1GB (CPU mode)
- Default model: whisper base.en — fast, good for English
- Upgrade to `small` or `medium` for better accuracy if hardware allows
- Audio files from WhatsApp are at `/var/lib/bloom/media/`
