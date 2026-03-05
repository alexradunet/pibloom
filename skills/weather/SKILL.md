---
name: weather
description: Retrieve current weather conditions by city or coordinates
---

# Weather Skill

Use this skill when the user asks for the latest weather.

## Tool-first

Use `weather_now` for current conditions.

Examples:

- `weather_now(location="Bucharest")`
- `weather_now(location="London, UK", units="imperial")`
- `weather_now(latitude=44.43225, longitude=26.10626)`

## Behavior

1. Prefer explicit user location when provided.
2. If the location is ambiguous, confirm city/country.
3. Keep response short: temperature, feels-like, conditions, precipitation, wind.
4. If user asks for more detail, include humidity and weather code interpretation.

## Data sources

`weather_now` uses:
- Open-Meteo (primary, no API key)
- wttr.in (automatic fallback if primary fails)
