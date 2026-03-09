---
name: lemonade
version: 0.1.0
description: Unified local AI platform — LLM, STT, TTS, and image generation via lemonade-server
image: ghcr.io/lemonade-sdk/lemonade-server:v9.4.1
---

# Lemonade Service

Unified local AI platform powered by [lemonade-server](https://lemonade-server.ai/). Provides OpenAI-compatible APIs for chat completions, audio transcription, text-to-speech, and image generation. Runs on CPU/GPU.

## Models

| Model | Type | Pull Command |
|-------|------|-------------|
| Qwen3-4B-GGUF | LLM (chat) | `lemonade-server pull Qwen3-4B-GGUF` |
| Whisper-Small | STT | `lemonade-server pull Whisper-Small` |
| SD-Turbo | Image Gen | `lemonade-server pull SD-Turbo` |
| Kokoro-v1 | TTS | `lemonade-server pull kokoro-v1` |

## API Endpoints

All on `http://localhost:8000`:

- `POST /api/v1/chat/completions` — Chat with LLM
- `POST /api/v1/audio/transcriptions` — Speech-to-text
- `POST /api/v1/audio/speech` — Text-to-speech
- `POST /api/v1/images/generations` — Image generation
- `GET /api/v1/models` — List loaded models
- `POST /api/v1/pull` — Download a model
- `GET /api/v1/health` — Health check

## Service Control

```bash
systemctl --user start bloom-lemonade.service
systemctl --user status bloom-lemonade
journalctl --user -u bloom-lemonade -f
```

## Notes

- Memory: ~6GB (all four model types can be loaded simultaneously)
- Models are downloaded on first use via `POST /api/v1/pull`
- Data persists in `bloom-lemonade-data` volume at `/root/.lemonade`
