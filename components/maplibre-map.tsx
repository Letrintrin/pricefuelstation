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
  route:
    | {
        type: "FeatureCollection"
        features: Array<{
          type: "Feature"
          geometry: { type: "LineString"; coordinates: [number, number][] }
          properties?: Record<string, unknown>
        }>
      }
    | null
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

export function StationsMap({ center, stations, route, onSelect }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const mapRef = React.useRef<MapLibreMap | null>(null)
  const stationsByIdRef = React.useRef<Map<string, MapStation>>(new Map())

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

  // Toujours garder une map id -> station à jour pour les handlers de clic
  React.useEffect(() => {
    const m = new Map<string, MapStation>()
    for (const s of stations) m.set(s.id, s)
    stationsByIdRef.current = m
  }, [stations])

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
      // Icônes de pin dessinées en canvas (couleurs par niveau de prix)
      const createPinImage = (color: string) => {
        const size = 64
        const canvas = document.createElement("canvas")
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          return {
            width: size,
            height: size,
            data: new Uint8ClampedArray(size * size * 4),
          }
        }

        ctx.clearRect(0, 0, size, size)

        const cx = size / 2
        const cy = size / 2 - 6
        const radius = 10

        // Tête du pin
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = "#111827"
        ctx.stroke()

        // Pointe du pin
        ctx.beginPath()
        ctx.moveTo(cx, cy + radius)
        ctx.lineTo(cx - radius * 0.7, cy + radius * 2.1)
        ctx.lineTo(cx + radius * 0.7, cy + radius * 2.1)
        ctx.closePath()
        ctx.fillStyle = color
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = "#111827"
        ctx.stroke()

        // Centre blanc
        ctx.beginPath()
        ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2)
        ctx.fillStyle = "#ffffff"
        ctx.fill()

        const imageData = ctx.getImageData(0, 0, size, size)
        return {
          width: imageData.width,
          height: imageData.height,
          data: imageData.data,
        }
      }

      map.addImage("station-pin-cheap", createPinImage("#16a34a"), { pixelRatio: 2 })
      map.addImage("station-pin-ok", createPinImage("#f97316"), { pixelRatio: 2 })
      map.addImage("station-pin-expensive", createPinImage("#dc2626"), { pixelRatio: 2 })
      map.addImage("station-pin-unknown", createPinImage("#6b7280"), { pixelRatio: 2 })

      // Source GeoJSON des stations
      map.addSource("stations", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      })

      // Source de l’itinéraire (ligne)
      map.addSource("routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      })

      map.addLayer({
        id: "routes",
        type: "line",
        source: "routes",
        paint: {
          "line-color": "#3b82f6",
          "line-width": 3,
          "line-opacity": 0.7,
        },
      })

      // Couches de pins par bucket de prix
      ;[
        { id: "stations-cheap", bucket: "cheap", icon: "station-pin-cheap" },
        { id: "stations-ok", bucket: "ok", icon: "station-pin-ok" },
        { id: "stations-expensive", bucket: "expensive", icon: "station-pin-expensive" },
        { id: "stations-unknown", bucket: "unknown", icon: "station-pin-unknown" },
      ].forEach(({ id, bucket, icon }) => {
        map.addLayer({
          id,
          type: "symbol",
          source: "stations",
          layout: {
            "icon-image": icon,
            "icon-size": 0.95,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          filter: ["==", ["get", "bucket"], bucket],
        })
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

      const stationLayers = [
        "stations-cheap",
        "stations-ok",
        "stations-expensive",
        "stations-unknown",
      ]

      stationLayers.forEach((layerId) => {
        map.on("click", layerId, (e) => {
          const f = e.features?.[0]
          const id = (f?.properties as any)?.id as string | undefined
          if (!id) return
          const st = stationsByIdRef.current.get(id)
          if (st) onSelect?.(st)
        })

        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer"
        })
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = ""
        })
      })
    })

    mapRef.current = map
  }, [center, onSelect])

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

    const routesSource = map.getSource("routes") as maplibregl.GeoJSONSource | undefined
    if (routesSource) {
      routesSource.setData(
        (route as any) ?? { type: "FeatureCollection", features: [] },
      )
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
  }, [center, maxPrice, minPrice, route, visibleStations])

  return <div ref={containerRef} className="h-full w-full" />
}

