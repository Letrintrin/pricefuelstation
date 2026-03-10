import { NextResponse } from "next/server"

const OSRM_ENDPOINT = "https://router.project-osrm.org/route/v1/driving"

function toNumber(value: string | null): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const fromLat = toNumber(url.searchParams.get("fromLat"))
  const fromLon = toNumber(url.searchParams.get("fromLon"))
  const toLat = toNumber(url.searchParams.get("toLat"))
  const toLon = toNumber(url.searchParams.get("toLon"))

  if (
    fromLat === undefined ||
    fromLon === undefined ||
    toLat === undefined ||
    toLon === undefined
  ) {
    return NextResponse.json(
      { error: "Paramètres requis: fromLat, fromLon, toLat, toLon." },
      { status: 400 },
    )
  }

  try {
    const osrmUrl = `${OSRM_ENDPOINT}/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson&alternatives=false&steps=false`
    const res = await fetch(osrmUrl)
    if (!res.ok) {
      return NextResponse.json(
        { error: "Service d’itinéraire indisponible." },
        { status: 502 },
      )
    }

    const data = (await res.json()) as {
      routes?: Array<{
        geometry?: { type: string; coordinates: [number, number][] }
        distance?: number
        duration?: number
      }>
    }

    const route = data.routes?.[0]
    if (!route?.geometry) {
      return NextResponse.json(
        { error: "Aucun itinéraire trouvé." },
        { status: 404 },
      )
    }

    return NextResponse.json({
      geometry: route.geometry,
      distance: route.distance ?? null,
      duration: route.duration ?? null,
    })
  } catch {
    return NextResponse.json(
      { error: "Erreur lors du calcul de l’itinéraire." },
      { status: 500 },
    )
  }
}

