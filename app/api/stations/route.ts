import { NextResponse } from "next/server"

type FuelKey = "gazole" | "sp95" | "sp98" | "e10" | "e85" | "gplc"

const DATASET_ENDPOINT =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records"

const CACHE_TTL_MS = 10 * 60 * 1000
let cached:
  | { fetchedAt: number; records: StationRecord[] }
  | undefined = undefined

type StationRecord = {
  id: string
  adresse?: string
  cp?: string
  ville?: string
  latitude?: number
  longitude?: number
  horaires?: unknown
  horaires_automate_24_24?: unknown
  services?: string
  carburants_disponibles?: string
  gazole_prix?: number
  sp95_prix?: number
  sp98_prix?: number
  e10_prix?: number
  e85_prix?: number
  gplc_prix?: number
  gazole_maj?: string
  sp95_maj?: string
  sp98_maj?: string
  e10_maj?: string
  e85_maj?: string
  gplc_maj?: string
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."))
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function normalizeGeoDegrees(
  lat: number | undefined,
  lon: number | undefined,
): { lat?: number; lon?: number } {
  if (lat === undefined || lon === undefined) return { lat, lon }

  // Le dataset fournit souvent des coordonnées en degrés * 1e5 (ex: 4716200 => 47.16200)
  let nLat = lat
  let nLon = lon
  if (Math.abs(nLat) > 90 || Math.abs(nLon) > 180) {
    nLat = nLat / 100000
    nLon = nLon / 100000
  }

  if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return {}
  if (Math.abs(nLat) > 90 || Math.abs(nLon) > 180) return {}
  return { lat: nLat, lon: nLon }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function pickFuel(fuelParam: string | null): FuelKey | "best" {
  const f = (fuelParam ?? "").toLowerCase()
  const allowed: Array<FuelKey | "best"> = [
    "best",
    "gazole",
    "sp95",
    "sp98",
    "e10",
    "e85",
    "gplc",
  ]
  return (allowed.includes(f as any) ? (f as any) : "best") as FuelKey | "best"
}

function bestPrice(st: StationRecord) {
  const candidates: Array<{ fuel: FuelKey; price: number; maj?: string }> = []
  const fuels: FuelKey[] = ["gazole", "sp95", "sp98", "e10", "e85", "gplc"]
  for (const f of fuels) {
    const price = toNumber((st as any)[`${f}_prix`])
    if (price !== undefined) {
      candidates.push({ fuel: f, price, maj: (st as any)[`${f}_maj`] })
    }
  }
  candidates.sort((a, b) => a.price - b.price)
  return candidates[0]
}

function toBoolOuiNon(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value === 1
  if (typeof value === "string") {
    const v = value.trim().toLowerCase()
    if (["oui", "1", "true", "vrai"].includes(v)) return true
    if (["non", "0", "false", "faux"].includes(v)) return false
  }
  return undefined
}

type HorairesJson = {
  ["@automate-24-24"]?: string
  jour?: Array<{
    ["@nom"]?: string
    ["@ferme"]?: string
    horaire?:
      | { ["@ouverture"]?: string; ["@fermeture"]?: string }
      | Array<{ ["@ouverture"]?: string; ["@fermeture"]?: string }>
  }>
}

function parseHoraires(raw: unknown): HorairesJson | undefined {
  if (!raw) return undefined
  if (typeof raw === "object") return raw as HorairesJson
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as HorairesJson
      return parsed
    } catch {
      return undefined
    }
  }
  return undefined
}

function parseTimeHHMM(t: string | undefined) {
  if (!t) return undefined
  // format attendu: "07.30" ou "07:30"
  const m = /^(\d{1,2})[.:](\d{2})$/.exec(t.trim())
  if (!m) return undefined
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return undefined
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined
  return hh * 60 + mm
}

function parisNow() {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date())

  const weekday = (parts.find((p) => p.type === "weekday")?.value ?? "").trim()
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0")
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0")
  return {
    weekday: weekday ? weekday[0].toUpperCase() + weekday.slice(1) : weekday,
    minutes: hour * 60 + minute,
  }
}

function isOpenNowFromHoraires(rawHoraires: unknown): boolean | null {
  const h = parseHoraires(rawHoraires)
  if (!h) return null

  if (h["@automate-24-24"] === "1") return true

  const now = parisNow()
  const day = h.jour?.find((d) => (d["@nom"] ?? "").trim() === now.weekday)
  if (!day) return null

  if (day["@ferme"] === "1") return false

  const horaires = day.horaire
  const intervals = Array.isArray(horaires) ? horaires : horaires ? [horaires] : []
  if (!intervals.length) return null

  for (const it of intervals) {
    const start = parseTimeHHMM(it["@ouverture"])
    const end = parseTimeHHMM(it["@fermeture"])
    if (start === undefined || end === undefined) continue
    if (start === end) return true // souvent utilisé pour "24h" dans certains exports
    if (start < end) {
      if (now.minutes >= start && now.minutes <= end) return true
    } else {
      // intervalle qui traverse minuit
      if (now.minutes >= start || now.minutes <= end) return true
    }
  }
  return false
}

async function fetchAllStations(): Promise<StationRecord[]> {
  const now = Date.now()
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.records

  const pageSize = 100
  let offset = 0
  let total = Number.POSITIVE_INFINITY
  const all: StationRecord[] = []

  // Réduit un peu la payload
  const select = [
    "id",
    "adresse",
    "cp",
    "ville",
    "latitude",
    "longitude",
    "horaires",
    "horaires_automate_24_24",
    "services",
    "carburants_disponibles",
    "gazole_prix",
    "sp95_prix",
    "sp98_prix",
    "e10_prix",
    "e85_prix",
    "gplc_prix",
    "gazole_maj",
    "sp95_maj",
    "sp98_maj",
    "e10_maj",
    "e85_maj",
    "gplc_maj",
  ].join(",")

  while (offset < total) {
    const apiUrl = new URL(DATASET_ENDPOINT)
    apiUrl.searchParams.set("limit", String(pageSize))
    apiUrl.searchParams.set("offset", String(offset))
    apiUrl.searchParams.set("select", select)

    const res = await fetch(apiUrl.toString(), {
      headers: { accept: "application/json" },
      next: { revalidate: 60 },
    })
    if (!res.ok) throw new Error("remote_api_error")

    const data = (await res.json()) as {
      total_count?: number
      results?: StationRecord[]
    }

    if (typeof data.total_count === "number" && Number.isFinite(data.total_count)) {
      total = data.total_count
    }

    const batch = data.results ?? []
    all.push(...batch)
    if (batch.length < pageSize) break
    offset += pageSize
  }

  cached = { fetchedAt: Date.now(), records: all }
  return all
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const lat = toNumber(url.searchParams.get("lat"))
  const lon = toNumber(url.searchParams.get("lon"))
  const radius = clamp(toNumber(url.searchParams.get("radius")) ?? 5000, 500, 20000)
  const limit = clamp(toNumber(url.searchParams.get("limit")) ?? 50, 1, 200)
  const fuel = pickFuel(url.searchParams.get("fuel"))
  const openNow = url.searchParams.get("openNow") === "1"

  if (lat === undefined || lon === undefined) {
    return NextResponse.json(
      { error: "Paramètres requis: lat, lon." },
      { status: 400 },
    )
  }

  let records: StationRecord[]
  try {
    records = await fetchAllStations()
  } catch {
    return NextResponse.json(
      { error: "Impossible de récupérer les stations." },
      { status: 502 },
    )
  }

  const stations = records.map((st) => {
    const rawLat = toNumber(st.latitude)
    const rawLon = toNumber(st.longitude)
    const { lat: stLat, lon: stLon } = normalizeGeoDegrees(rawLat, rawLon)
    const distanceKm =
      stLat !== undefined && stLon !== undefined
        ? haversineKm(lat, lon, stLat, stLon)
        : undefined

    let selected:
      | { fuel: FuelKey; price: number; maj?: string }
      | undefined = undefined

    if (fuel === "best") {
      selected = bestPrice(st)
    } else {
      const price = toNumber((st as any)[`${fuel}_prix`])
      selected =
        price === undefined
          ? undefined
          : { fuel, price, maj: (st as any)[`${fuel}_maj`] }
    }

    return {
      id: st.id,
      name: st.ville ?? st.adresse ?? "Station",
      adresse: st.adresse,
      cp: st.cp,
      ville: st.ville,
      services: st.services,
      carburants_disponibles: st.carburants_disponibles,
      openNow: isOpenNowFromHoraires(st.horaires),
      automate24_24: toBoolOuiNon(st.horaires_automate_24_24),
      latitude: stLat,
      longitude: stLon,
      distanceKm,
      selected,
      prices: {
        gazole: toNumber(st.gazole_prix),
        sp95: toNumber(st.sp95_prix),
        sp98: toNumber(st.sp98_prix),
        e10: toNumber(st.e10_prix),
        e85: toNumber(st.e85_prix),
        gplc: toNumber(st.gplc_prix),
      },
    }
  })

  // Filtrage serveur strict dans le rayon (en mètres) après normalisation des coordonnées.
  const withinRadius = stations.filter((s) => {
    if (s.distanceKm === undefined) return false
    // On ajoute une petite marge (2 km) pour compenser les imprécisions de coordonnées du dataset.
    return s.distanceKm * 1000 <= radius + 2000
  })

  const filtered = openNow
    ? withinRadius.filter((s) => s.openNow === true)
    : withinRadius

  filtered.sort((a, b) => {
    const da = a.distanceKm ?? Number.POSITIVE_INFINITY
    const db = b.distanceKm ?? Number.POSITIVE_INFINITY
    if (da !== db) return da - db
    const pa = a.selected?.price ?? Number.POSITIVE_INFINITY
    const pb = b.selected?.price ?? Number.POSITIVE_INFINITY
    return pa - pb
  })

  return NextResponse.json({ stations: filtered.slice(0, limit) })
}

