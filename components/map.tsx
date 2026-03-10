"use client"

import "leaflet/dist/leaflet.css"
import { memo, useEffect, useMemo } from "react"
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  useMap,
} from "react-leaflet"
import { latLngBounds, type LatLngExpression } from "leaflet"

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

function Recenter({ center }: { center: LatLngExpression }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, map.getZoom() || 13, { animate: true })
    // Sur mobile, Leaflet peut “rater” le layout au premier render.
    setTimeout(() => map.invalidateSize(), 50)
  }, [center, map])
  return null
}

function FitToStations({ stations }: { stations: Array<[number, number]> }) {
  const map = useMap()
  useEffect(() => {
    if (!stations.length) return
    const b = latLngBounds(stations)
    map.fitBounds(b.pad(0.2), { animate: true, maxZoom: 15 })
    setTimeout(() => map.invalidateSize(), 50)
  }, [map, stations])
  return null
}

function priceColor(
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
    return "#6b7280" // gris si pas de données
  }

  const range = maxPrice - minPrice
  const t1 = minPrice + range / 3
  const t2 = minPrice + (2 * range) / 3

  if (price <= t1) {
    return "#16a34a" // vert: pas cher
  }
  if (price <= t2) {
    return "#f97316" // orange: ça va
  }
  return "#dc2626" // rouge: cher
}

function InnerMap({ center, stations, onSelect }: Props) {
  const defaultCenter: LatLngExpression = center
    ? [center.lat, center.lon]
    : [48.8566, 2.3522]

  const visibleStations = useMemo(
    () =>
      stations.filter(
        (s) => typeof s.latitude === "number" && typeof s.longitude === "number",
      ),
    [stations],
  )

  const stationLatLngs = useMemo(
    () =>
      visibleStations.map((s) => [s.latitude as number, s.longitude as number] as [
        number,
        number,
      ]),
    [visibleStations],
  )

  const prices = visibleStations
    .map((s) => s.selected?.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p))

  const minPrice = prices.length ? Math.min(...prices) : undefined
  const maxPrice = prices.length ? Math.max(...prices) : undefined

  return (
    <MapContainer
      center={defaultCenter}
      zoom={13}
      scrollWheelZoom={true}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contrib.'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {center && (
        <>
          <Recenter center={defaultCenter} />
          <CircleMarker
            center={defaultCenter}
            radius={8}
            pathOptions={{
              color: "#1d4ed8",
              fillColor: "#3b82f6",
              fillOpacity: 0.95,
              weight: 2,
            }}
          />
        </>
      )}
      {stationLatLngs.length > 0 && <FitToStations stations={stationLatLngs} />}
      {visibleStations.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.latitude!, s.longitude!] as LatLngExpression}
          radius={12}
          pathOptions={{
            color: "#111827",
            fillColor: priceColor(s.selected?.price, minPrice, maxPrice),
            fillOpacity: 0.95,
            weight: 3,
          }}
          eventHandlers={{
            click: () => {
              onSelect?.(s)
            },
          }}
        >
        </CircleMarker>
      ))}
    </MapContainer>
  )
}

export const StationsMap = memo(InnerMap)

