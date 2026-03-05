import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { errorResult } from "../lib/shared.js";

type Units = "metric" | "imperial";

interface OpenMeteoGeoResponse {
	results?: Array<{
		name: string;
		latitude: number;
		longitude: number;
		country?: string;
		admin1?: string;
		timezone?: string;
	}>;
}

interface OpenMeteoCurrentResponse {
	current?: {
		time: string;
		temperature_2m: number;
		apparent_temperature: number;
		relative_humidity_2m: number;
		precipitation: number;
		weather_code: number;
		wind_speed_10m: number;
	};
	current_units?: {
		temperature_2m?: string;
		apparent_temperature?: string;
		relative_humidity_2m?: string;
		precipitation?: string;
		wind_speed_10m?: string;
	};
}

interface WttrResponse {
	nearest_area?: Array<{
		areaName?: Array<{ value?: string }>;
		region?: Array<{ value?: string }>;
		country?: Array<{ value?: string }>;
	}>;
	current_condition?: Array<{
		temp_C?: string;
		temp_F?: string;
		FeelsLikeC?: string;
		FeelsLikeF?: string;
		humidity?: string;
		precipMM?: string;
		weatherDesc?: Array<{ value?: string }>;
		windspeedKmph?: string;
		windspeedMiles?: string;
		localObsDateTime?: string;
	}>;
}

function weatherCodeToText(code: number): string {
	switch (code) {
		case 0:
			return "clear sky";
		case 1:
			return "mainly clear";
		case 2:
			return "partly cloudy";
		case 3:
			return "overcast";
		case 45:
		case 48:
			return "fog";
		case 51:
		case 53:
		case 55:
			return "drizzle";
		case 56:
		case 57:
			return "freezing drizzle";
		case 61:
		case 63:
		case 65:
			return "rain";
		case 66:
		case 67:
			return "freezing rain";
		case 71:
		case 73:
		case 75:
			return "snow";
		case 77:
			return "snow grains";
		case 80:
		case 81:
		case 82:
			return "rain showers";
		case 85:
		case 86:
			return "snow showers";
		case 95:
			return "thunderstorm";
		case 96:
		case 99:
			return "thunderstorm with hail";
		default:
			return `weather code ${code}`;
	}
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
	const response = await fetch(url, {
		headers: {
			Accept: "application/json",
		},
		signal,
	});

	if (!response.ok) {
		throw new Error(`Request failed (${response.status}) for ${url}`);
	}

	return (await response.json()) as T;
}

function formatPlace(name: string, region?: string, country?: string): string {
	const parts = [name, region, country].filter((v) => !!v?.trim());
	const deduped = parts.filter((part, idx) => parts.indexOf(part) === idx);
	return deduped.join(", ");
}

async function fetchFromWttr(location: string, units: Units, signal?: AbortSignal) {
	const wttrUrl = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
	const wttr = await fetchJson<WttrResponse>(wttrUrl, signal);
	const current = wttr.current_condition?.[0];
	if (!current) {
		throw new Error("wttr.in response missing current_condition");
	}

	const area = wttr.nearest_area?.[0];
	const place = formatPlace(
		area?.areaName?.[0]?.value ?? location,
		area?.region?.[0]?.value,
		area?.country?.[0]?.value,
	);
	const weatherText = current.weatherDesc?.[0]?.value ?? "unknown";
	const temp = units === "imperial" ? current.temp_F : current.temp_C;
	const feels = units === "imperial" ? current.FeelsLikeF : current.FeelsLikeC;
	const wind = units === "imperial" ? current.windspeedMiles : current.windspeedKmph;
	const tempUnit = units === "imperial" ? "°F" : "°C";
	const windUnit = units === "imperial" ? "mph" : "km/h";

	const summary = `${place}: ${temp}${tempUnit} (feels ${feels}${tempUnit}), ${weatherText}, humidity ${current.humidity}%, precipitation ${current.precipMM} mm, wind ${wind} ${windUnit}.`;
	return {
		summary,
		source: "wttr.in",
		place,
		time: current.localObsDateTime ?? null,
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "weather_now",
		label: "Weather Now",
		description: "Get current weather for a location",
		promptSnippet: "Get latest weather conditions for a city or coordinates",
		promptGuidelines: [
			"Use weather_now when the user asks for current weather.",
			"Prefer location names, but latitude/longitude can be used directly.",
			"If the primary provider fails, weather_now falls back to wttr.in.",
		],
		parameters: Type.Object({
			location: Type.Optional(
				Type.String({
					description: "City/place name (e.g. Bucharest, London, UK)",
				}),
			),
			latitude: Type.Optional(
				Type.Number({
					description: "Latitude for direct weather lookup",
				}),
			),
			longitude: Type.Optional(
				Type.Number({
					description: "Longitude for direct weather lookup",
				}),
			),
			units: Type.Optional(
				Type.Union([Type.Literal("metric"), Type.Literal("imperial")], {
					description: "Unit system (default: metric)",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const units: Units = params.units ?? "metric";
			const hasLat = typeof params.latitude === "number";
			const hasLon = typeof params.longitude === "number";
			if (hasLat !== hasLon) {
				return errorResult("Provide both latitude and longitude, or neither.");
			}

			const location = params.location?.trim();
			if (!hasLat && !hasLon && !location) {
				return errorResult("Please provide a location, or latitude + longitude.");
			}

			try {
				let latitude = params.latitude;
				let longitude = params.longitude;
				let place = location ?? "custom location";

				if (!hasLat || !hasLon) {
					const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({
						name: location ?? "",
						count: "1",
					})}`;
					const geo = await fetchJson<OpenMeteoGeoResponse>(geoUrl, signal);
					const best = geo.results?.[0];
					if (!best) {
						return errorResult(`No location match for "${location}".`);
					}
					latitude = best.latitude;
					longitude = best.longitude;
					place = formatPlace(best.name, best.admin1, best.country);
				}

				const query = new URLSearchParams({
					latitude: String(latitude),
					longitude: String(longitude),
					current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
					timezone: "auto",
				});
				if (units === "imperial") {
					query.set("temperature_unit", "fahrenheit");
					query.set("wind_speed_unit", "mph");
					query.set("precipitation_unit", "inch");
				}

				const weatherUrl = `https://api.open-meteo.com/v1/forecast?${query}`;
				const weather = await fetchJson<OpenMeteoCurrentResponse>(weatherUrl, signal);
				if (!weather.current) {
					return errorResult("Weather response did not include current conditions.");
				}

				const current = weather.current;
				const u = weather.current_units ?? {};
				const condition = weatherCodeToText(Number(current.weather_code));
				const summary = `${place}: ${current.temperature_2m}${u.temperature_2m ?? "°C"} (feels ${current.apparent_temperature}${u.apparent_temperature ?? "°C"}), ${condition}, humidity ${current.relative_humidity_2m}${u.relative_humidity_2m ?? "%"}, precipitation ${current.precipitation}${u.precipitation ?? "mm"}, wind ${current.wind_speed_10m}${u.wind_speed_10m ?? "km/h"}.`;

				return {
					content: [{ type: "text" as const, text: summary }],
					details: {
						source: "open-meteo",
						place,
						latitude,
						longitude,
						time: current.time,
						units,
						current,
					},
				};
			} catch (error) {
				if (location) {
					try {
						const fallback = await fetchFromWttr(location, units, signal);
						return {
							content: [{ type: "text" as const, text: fallback.summary }],
							details: {
								source: fallback.source,
								place: fallback.place,
								time: fallback.time,
								units,
								fallback: true,
							},
						};
					} catch (fallbackError) {
						return errorResult(
							`Weather lookup failed (primary + fallback): ${(error as Error).message}; ${(fallbackError as Error).message}`,
						);
					}
				}
				return errorResult(`Weather lookup failed: ${(error as Error).message}`);
			}
		},
	});
}
