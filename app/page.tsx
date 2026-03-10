"use client"

import * as React from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import dynamic from "next/dynamic"

import type { MapStation } from "@/components/mapbox-map"

const StationsMap = dynamic(
  () => import("@/components/mapbox-map").then((m) => m.StationsMap),
  {
    ssr: false,
  },
)

type FuelKey = "best" | "gazole" | "sp95" | "sp98" | "e10" | "e85" | "gplc"

type ApiStation = {
  id: string
  name: string
  adresse?: string
  cp?: string
  ville?: string
  distanceKm?: number
  openNow?: boolean | null
  latitude?: number
  longitude?: number
  selected?: { fuel: Exclude<FuelKey, "best">; price: number; maj?: string }
  prices: Partial<Record<Exclude<FuelKey, "best">, number>>
}

function formatKm(km?: number) {
  if (km === undefined) return "—"
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}

function formatEuro(price?: number) {
  if (price === undefined) return "—"
  return `${price.toFixed(3)} €`
}

function fuelLabel(fuel: FuelKey) {
  switch (fuel) {
    case "best":
      return "Meilleur prix"
    case "gazole":
      return "Gazole"
    case "sp95":
      return "SP95"
    case "sp98":
      return "SP98"
    case "e10":
      return "E10"
    case "e85":
      return "E85"
    case "gplc":
      return "GPLc"
  }
}

export default function Home() {
  const [fuel, setFuel] = React.useState<FuelKey>("best")
  const [radius, setRadius] = React.useState<number>(5000)
  const [openNow, setOpenNow] = React.useState<boolean>(false)
  const [status, setStatus] = React.useState<
    "idle" | "locating" | "loading" | "ready" | "error"
  >("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [coords, setCoords] = React.useState<{ lat: number; lon: number } | null>(
    null,
  )
  const [stations, setStations] = React.useState<ApiStation[]>([])
  const [focusedId, setFocusedId] = React.useState<string | null>(null)
  const [showLocationPrompt, setShowLocationPrompt] = React.useState(false)

  const loadStations = React.useCallback(
    async (lat: number, lon: number, f: FuelKey, r: number, open: boolean) => {
      setStatus("loading")
      setError(null)
      try {
        const qs = new URLSearchParams()
        qs.set("lat", String(lat))
        qs.set("lon", String(lon))
        qs.set("radius", String(r))
        qs.set("limit", "200")
        qs.set("fuel", f)
        if (open) qs.set("openNow", "1")
        const res = await fetch(`/api/stations?${qs.toString()}`)
        if (!res.ok) throw new Error("API indisponible")
        const json = (await res.json()) as { stations: ApiStation[] }
        setStations(json.stations ?? [])
        setStatus("ready")
      } catch {
        setStatus("error")
        setError(
          "Impossible de charger les stations autour de toi. Réessaie dans un instant.",
        )
      }
    },
    [],
  )

  const askLocation = React.useCallback(() => {
    if (!window.isSecureContext) {
      setStatus("error")
      setError(
        "Sur mobile, la localisation ne marche que sur un site HTTPS (ou sur localhost directement sur le téléphone). Utilise un lien HTTPS (ex: Vercel / tunnel) puis réessaie.",
      )
      return
    }
    if (!("geolocation" in navigator)) {
      setStatus("error")
      setError("La géolocalisation n’est pas supportée sur ce navigateur.")
      return
    }
    setStatus("locating")
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lon = pos.coords.longitude
        setCoords({ lat, lon })
        void loadStations(lat, lon, fuel, radius, openNow)
      },
      (err) => {
        setStatus("error")
        setError(
          `Impossible d’obtenir la localisation (${err.code}). ${err.message || "Vérifie les permissions de localisation du navigateur."}`,
        )
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60_000 },
    )
  }, [fuel, loadStations, openNow, radius])

  React.useEffect(() => {
    if (coords) return
    try {
      const skipped = window.localStorage.getItem("skipLocationPrompt") === "1"
      if (!skipped) setShowLocationPrompt(true)
    } catch {
      setShowLocationPrompt(true)
    }
  }, [coords])

  React.useEffect(() => {
    if (!coords) return
    void loadStations(coords.lat, coords.lon, fuel, radius, openNow)
  }, [coords, fuel, loadStations, openNow, radius])

  const mapStations: MapStation[] = React.useMemo(
    () =>
      stations.map((s) => ({
        id: s.id,
        name: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
        distanceKm: s.distanceKm,
        selected: s.selected as any,
      })),
    [stations],
  )

  const hasLocation = !!coords
  const focusedStation = React.useMemo(
    () => stations.find((s) => s.id === focusedId) ?? null,
    [focusedId, stations],
  )

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <AlertDialog open={showLocationPrompt} onOpenChange={setShowLocationPrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activer la localisation ?</AlertDialogTitle>
            <AlertDialogDescription>
              On en a besoin pour afficher les stations-service et leurs prix autour de
              toi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                try {
                  window.localStorage.setItem("skipLocationPrompt", "1")
                } catch {}
              }}
            >
              Plus tard
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowLocationPrompt(false)
                askLocation()
              }}
            >
              Activer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <header className="hidden border-b bg-background/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:block">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Carburant autour de moi</p>
            <h1 className="text-base font-semibold tracking-tight">
              Carte des stations
            </h1>
          </div>
          <Button size="sm" variant="outline" onClick={askLocation}>
            {hasLocation ? "Actualiser" : "Localiser"}
          </Button>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col pb-20 sm:mx-auto sm:w-full sm:max-w-md sm:px-4 sm:pb-24 sm:pt-3">
        <div className="relative flex-1 min-h-0 w-full overflow-hidden bg-card sm:h-[60vh] sm:flex-none sm:rounded-xl sm:border">
          {showLocationPrompt ? (
            <div className="flex h-full w-full items-center justify-center bg-muted/30">
              <div className="w-full max-w-xs rounded-xl border bg-background/80 p-4 text-center shadow-sm">
                <p className="text-sm font-medium">Localisation requise</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Active la localisation pour afficher la carte et les stations autour de
                  toi.
                </p>
              </div>
            </div>
          ) : (
            <StationsMap
              center={coords}
              stations={mapStations}
              onSelect={(s) => setFocusedId(s.id)}
            />
          )}

          {status === "idle" && (
            <div className="pointer-events-none absolute inset-x-4 top-4 z-10 sm:inset-x-4">
              <div className="pointer-events-auto rounded-xl border bg-background/90 p-3 text-sm shadow-lg">
                <p className="font-medium">Autorise la localisation</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pour afficher les stations et leurs prix autour de toi (~5 km), appuie
                  sur “Localiser” en bas de l’écran.
                </p>
              </div>
            </div>
          )}

          {status === "locating" && (
            <div className="absolute inset-x-4 top-4 z-10">
              <div className="rounded-xl border bg-background/90 p-3 shadow-lg">
                <p className="text-sm font-medium">Localisation en cours…</p>
                <div className="mt-2 space-y-2">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            </div>
          )}

          {status === "loading" && (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10">
              <div className="pointer-events-auto rounded-xl border bg-background/90 p-3 text-sm shadow-lg">
                <p className="font-medium">Chargement des stations…</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Reste sur la page, ça ne prend que quelques secondes.
                </p>
              </div>
            </div>
          )}

          {status === "error" && error && (
            <div className="absolute inset-x-4 top-4 z-10">
              <Alert variant="destructive">
                <AlertTitle>Oups</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p className="text-xs sm:text-sm">{error}</p>
                  <Button size="sm" variant="outline" onClick={askLocation}>
                    Réessayer
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {status === "ready" && stations.length === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="rounded-xl border bg-background/90 px-4 py-3 text-sm shadow-lg">
                Aucune station trouvée dans ce rayon. On pourra ajouter un réglage de
                distance si tu veux.
              </div>
            </div>
          )}

          {focusedStation && (
            <div className="absolute inset-x-4 top-4 z-20">
              <div
                className="rounded-xl border bg-background/95 p-3 text-sm shadow-lg"
                onClick={() => setFocusedId(null)}
              >
                <p className="font-semibold truncate">{focusedStation.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {focusedStation.adresse ? `${focusedStation.adresse}, ` : ""}
                  {focusedStation.cp ? `${focusedStation.cp} ` : ""}
                  {focusedStation.ville ?? ""}
                </p>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span>
                    {focusedStation.distanceKm !== undefined
                      ? `${formatKm(focusedStation.distanceKm)}`
                      : ""}
                  </span>
                  <span>
                    {focusedStation.selected
                      ? `${fuelLabel(
                          focusedStation.selected.fuel as FuelKey,
                        )} · ${formatEuro(focusedStation.selected.price)}`
                      : ""}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-md items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
          <div className="hidden flex-1 text-xs text-muted-foreground sm:block">
            <div className="font-medium text-foreground">
              {stations.length > 0
                ? `${stations.length} station${stations.length > 1 ? "s" : ""} trouvée${
                    stations.length > 1 ? "s" : ""
                  }`
                : "Aucune station chargée"}
            </div>
            <div>
              {coords
                ? "Autour de ta position"
                : "Appuie sur Localiser pour commencer"}
            </div>
          </div>

          <Sheet>
            <SheetTrigger className="inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted">
              {fuel === "best" ? "Carburant: meilleur prix" : fuelLabel(fuel)}
            </SheetTrigger>
            <SheetContent side="top" className="mx-auto w-full max-w-md">
              <SheetHeader>
                <SheetTitle>Choisis ton carburant</SheetTitle>
              </SheetHeader>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {(["best", "gazole", "e10", "sp95", "sp98", "e85", "gplc"] as FuelKey[]).map(
                  (f) => (
                    <Button
                      key={f}
                      size="sm"
                      variant={fuel === f ? "default" : "outline"}
                      onClick={() => setFuel(f)}
                    >
                      {fuelLabel(f)}
                    </Button>
                  ),
                )}
              </div>
            </SheetContent>
          </Sheet>

          <Sheet>
            <SheetTrigger className="inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted">
              Rayon: {radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}
            </SheetTrigger>
            <SheetContent side="top" className="mx-auto w-full max-w-md">
              <SheetHeader>
                <SheetTitle>Rayon de recherche</SheetTitle>
              </SheetHeader>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[1000, 3000, 5000, 10000, 20000].map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={radius === r ? "default" : "outline"}
                    onClick={() => setRadius(r)}
                  >
                    {r >= 1000 ? `${r / 1000} km` : `${r} m`}
                  </Button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Plus le rayon est grand, plus le chargement peut être long.
              </p>
            </SheetContent>
          </Sheet>

          <Button
            size="sm"
            variant={openNow ? "default" : "outline"}
            onClick={() => setOpenNow((v) => !v)}
          >
            Ouvert
          </Button>

          <Button size="sm" onClick={askLocation}>
            {hasLocation ? "Actualiser" : "Localiser"}
          </Button>
        </div>
      </footer>
    </div>
  )
}
