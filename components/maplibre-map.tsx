"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl"
import * as React from "react"

type FuelKey = "gazole" | "sp95" | "sp98" | "e10" | "e85" | "gplc"

export type MapStation = {
  id: string
  name: string
  latitude?: number
  longitude?: number
  distanceKm?: number
  selected?: { fuel: FuelKey; price: number; maj?: string }
}

type Props = {
  center: { lat: number; lon: number } | null
  stations: MapStation[]
  onSelect?: (station: MapStation) => void
}

function priceBucket(
  price: number | undefined,
  minPrice: number | undefined,
  maxPrice: number | undefined,
) {
  if (
    price === undefined ||
    minPrice === undefined ||
    maxPrice === undefined ||
    !Number.isFinite(price) ||
    !Number.isFinite(minPrice) ||
    !Number.isFinite(maxPrice) ||
    maxPrice <= minPrice
  ) {
    return "unknown"
  }
  const range = maxPrice - minPrice
  const t1 = minPrice + range / 3
  const t2 = minPrice + (2 * range) / 3
  if (price <= t1) return "cheap"
  if (price <= t2) return "ok"
  return "expensive"
}

export function StationsMap({ center, stations, onSelect }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const mapRef = React.useRef<MapLibreMap | null>(null)
  const stationsById = React.useMemo(() => {
    const m = new Map<string, MapStation>()
    for (const s of stations) m.set(s.id, s)
    return m
  }, [stations])

  const visibleStations = React.useMemo(
    () =>
      stations.filter(
        (s) =>
          typeof s.latitude === "number" &&
          typeof s.longitude === "number" &&
          Number.isFinite(s.latitude) &&
          Number.isFinite(s.longitude) &&
          Math.abs(s.latitude) <= 90 &&
          Math.abs(s.longitude) <= 180,
      ),
    [stations],
  )

  const prices = React.useMemo(() => {
    return visibleStations
      .map((s) => s.selected?.price)
      .filter((p): p is number => typeof p === "number" && Number.isFinite(p))
  }, [visibleStations])

  const minPrice = prices.length ? Math.min(...prices) : undefined
  const maxPrice = prices.length ? Math.max(...prices) : undefined

  // Init map (client only)
  React.useEffect(() => {
    if (!containerRef.current) return
    if (mapRef.current) return

    const initialCenter: [number, number] = center
      ? [center.lon, center.lat]
      : [2.3522, 48.8566]

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '© <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: initialCenter,
      zoom: 12.5,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")

    map.on("load", () => {
      // Stations source/layer
      map.addSource("stations", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      })

      map.addLayer({
        id: "stations",
        type: "circle",
        source: "stations",
        paint: {
          "circle-radius": 9,
          "circle-color": [
            "match",
            ["get", "bucket"],
            "cheap",
            "#16a34a",
            "ok",
            "#f97316",
            "expensive",
            "#dc2626",
            "#6b7280",
          ],
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 2,
          "circle-opacity": 0.95,
        },
      })

      // User position source/layer
      map.addSource("me", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      })
      // Halo derrière le point "moi"
      map.addLayer({
        id: "me-halo",
        type: "circle",
        source: "me",
        paint: {
          "circle-radius": 22,
          "circle-color": "#8b5cf6", // violet
          "circle-opacity": 0.25,
          "circle-blur": 0.6,
        },
        layout: {
          visibility: "visible",
        },
      })
      map.addLayer({
        id: "me",
        type: "circle",
        source: "me",
        paint: {
          "circle-radius": 12,
          "circle-color": "#3b82f6", // bleu
          "circle-stroke-color": "#111827", // contour noir
          "circle-stroke-width": 4,
          "circle-opacity": 0.95,
        },
      })

      map.on("click", "stations", (e) => {
        const f = e.features?.[0]
        const id = (f?.properties as any)?.id as string | undefined
        if (!id) return
        const st = stationsById.get(id)
        if (st) onSelect?.(st)
      })

      map.on("mouseenter", "stations", () => {
        map.getCanvas().style.cursor = "pointer"
      })
      map.on("mouseleave", "stations", () => {
        map.getCanvas().style.cursor = ""
      })
    })

    mapRef.current = map
  }, [center, onSelect, stationsById])

  // Update sources on data change
  React.useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!map.isStyleLoaded()) return

    const stSource = map.getSource("stations") as maplibregl.GeoJSONSource | undefined
    if (stSource) {
      stSource.setData({
        type: "FeatureCollection",
        features: visibleStations.map((s) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [s.longitude as number, s.latitude as number],
          },
          properties: {
            id: s.id,
            bucket: priceBucket(s.selected?.price, minPrice, maxPrice),
          },
        })),
      })
    }

    const meSource = map.getSource("me") as maplibregl.GeoJSONSource | undefined
    if (meSource) {
      meSource.setData({
        type: "FeatureCollection",
        features: center
          ? [
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [center.lon, center.lat],
                },
                properties: {},
              },
            ]
          : [],
      })
    }

    // Fit view to stations (or center)
    if (visibleStations.length) {
      const bounds = new maplibregl.LngLatBounds()
      for (const s of visibleStations) {
        bounds.extend([s.longitude as number, s.latitude as number])
      }
      if (center) bounds.extend([center.lon, center.lat])
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 500 })
    } else if (center) {
      map.easeTo({ center: [center.lon, center.lat], zoom: 13, duration: 400 })
    }
  }, [center, maxPrice, minPrice, visibleStations])

  return <div ref={containerRef} className="h-full w-full" />
}

