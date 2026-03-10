"use client"

import "mapbox-gl/dist/mapbox-gl.css"
import mapboxgl, { type Map as MapboxMap } from "mapbox-gl"
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
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const mapRef = React.useRef<MapboxMap | null>(null)
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

  React.useEffect(() => {
    if (!containerRef.current) return
    if (mapRef.current) return
    if (!token) return

    mapboxgl.accessToken = token

    const initialCenter: [number, number] = center
      ? [center.lon, center.lat]
      : [2.3522, 48.8566]

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: initialCenter,
      zoom: 12.5,
      attributionControl: true,
    })

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right")

    map.on("load", () => {
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

      map.addSource("me", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      })
      map.addLayer({
        id: "me-halo",
        type: "circle",
        source: "me",
        paint: {
          "circle-radius": 22,
          "circle-color": "#8b5cf6",
          "circle-opacity": 0.25,
          "circle-blur": 0.6,
        },
      })
      map.addLayer({
        id: "me",
        type: "circle",
        source: "me",
        paint: {
          "circle-radius": 12,
          "circle-color": "#3b82f6",
          "circle-stroke-color": "#111827",
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

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [center, onSelect, stationsById, token])

  React.useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!map.isStyleLoaded()) return

    const stSource = map.getSource("stations") as mapboxgl.GeoJSONSource | undefined
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

    const meSource = map.getSource("me") as mapboxgl.GeoJSONSource | undefined
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

    if (visibleStations.length) {
      const bounds = new mapboxgl.LngLatBounds()
      for (const s of visibleStations) {
        bounds.extend([s.longitude as number, s.latitude as number])
      }
      if (center) bounds.extend([center.lon, center.lat])
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 500 })
    } else if (center) {
      map.easeTo({ center: [center.lon, center.lat], zoom: 13, duration: 400 })
    }
  }, [center, maxPrice, minPrice, visibleStations])

  if (!token) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted/30">
        <div className="w-full max-w-xs rounded-xl border bg-background/90 p-4 text-center shadow-sm">
          <p className="text-sm font-medium">Clé Mapbox manquante</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ajoute <code className="font-mono">NEXT_PUBLIC_MAPBOX_TOKEN</code> dans un fichier{" "}
            <code className="font-mono">.env.local</code>, puis relance le serveur.
          </p>
        </div>
      </div>
    )
  }

  return <div ref={containerRef} className="h-full w-full" />
}

