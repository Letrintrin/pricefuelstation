# SITE_INFO — “Carburant autour de moi”

## Résumé

Ce projet est une application **Next.js (App Router)** “mobile-first” qui :

- demande la **géolocalisation** de l’utilisateur,
- récupère les **stations-service** autour de lui via une **API interne**,
- affiche les résultats sur une **carte** (implémentation principale: **MapLibre GL**),
- permet de filtrer par **carburant**, **rayon**, et **“ouvert maintenant”**.

Métadonnées du site (SEO) :
- **Titre**: “Carburant autour de moi”
- **Description**: “Prix des carburants autour de vous (mobile-first).”
  - Source: `app/layout.tsx`

## Stack technique

- **Framework**: Next.js `16.1.6` (React `19.2.3`)
  - Source: `package.json`
- **UI**: Tailwind CSS v4 + shadcn
  - Source: `app/globals.css`, `package.json`
- **Cartographie**
  - **MapLibre GL** (utilisé par défaut dans la page): `maplibre-gl`
    - Source: `components/maplibre-map.tsx`, `app/page.tsx`
  - **Leaflet / React-Leaflet** (autre implémentation disponible): `react-leaflet`, `leaflet`
    - Source: `components/map.tsx`

## Structure applicative (fichiers importants)

- **Routes**
  - `/` → `app/page.tsx`
  - `/api/stations` → `app/api/stations/route.ts`
- **Layout global**: `app/layout.tsx`
- **Styles globaux**: `app/globals.css`
- **Page principale**: `app/page.tsx`
- **API (server)**: `app/api/stations/route.ts`
- **Carte MapLibre (client)**: `components/maplibre-map.tsx`
- **Carte Leaflet (client, alternative)**: `components/map.tsx`
- **Config Next**: `next.config.ts` (actuellement minimal)
- **TypeScript**: `tsconfig.json` (alias `@/*` → `./*`)
- **Lint**: `eslint.config.mjs`
- **PostCSS**: `postcss.config.mjs`

## Fonctionnalités côté UI (page `app/page.tsx`)

### Parcours utilisateur

- Au premier chargement, l’app affiche une boîte de dialogue pour demander d’activer la localisation.
- Une fois la localisation obtenue, la page appelle l’API interne pour charger les stations.
- La carte affiche :
  - un point **“moi”** (position utilisateur),
  - des marqueurs **stations** colorés selon le “niveau de prix” (pas cher / moyen / cher).

Note: la carte est importée en **dynamic import** avec `ssr: false` (donc rendu carte uniquement côté client).
Source: `app/page.tsx`

### Contrôle & filtres

Paramètres UI gérés par état React :

- **Carburant**: “Meilleur prix” (par défaut) ou un carburant précis
  - valeurs: `best`, `gazole`, `sp95`, `sp98`, `e10`, `e85`, `gplc`
- **Rayon** (par défaut 5000 m) avec boutons rapides: 1 km / 3 km / 5 km / 10 km / 20 km
- **Ouvert maintenant**: toggle “Ouvert”

### Contrainte importante: HTTPS pour la géolocalisation

La page vérifie `window.isSecureContext` et affiche un message d’erreur si le site n’est pas servi en **HTTPS** (cas typique sur mobile, hors localhost).
Source: `app/page.tsx`

## API interne: `GET /api/stations`

### Source de données

L’API interroge le dataset public :

- `prix-des-carburants-en-france-flux-instantane-v2`
- endpoint (Opendatasoft): `https://data.economie.gouv.fr/.../records`
Source: `app/api/stations/route.ts`

### Paramètres de requête (query string)

- **lat** (obligatoire): latitude utilisateur
- **lon** (obligatoire): longitude utilisateur
- **radius** (optionnel, défaut 5000): en **mètres**
  - clamp serveur: min 500, max 20000
- **limit** (optionnel, défaut 50): nombre de stations renvoyées
  - clamp serveur: min 1, max 200
- **fuel** (optionnel, défaut `best`): `best|gazole|sp95|sp98|e10|e85|gplc`
- **openNow** (optionnel): `1` pour filtrer “ouvert maintenant”

### Traitements côté serveur (résumé)

- **Cache mémoire** côté serveur :
  - TTL: 10 minutes (`CACHE_TTL_MS`)
  - but: éviter de re-télécharger tout le dataset trop souvent
- **Pagination** distante: lecture par lots de 100 jusqu’à `total_count`
- **Normalisation géographique**:
  - le dataset peut fournir des coordonnées en “degrés × 1e5” (ex: `4716200` → `47.16200`)
  - la route normalise en divisant par 100000 si nécessaire
- **Distance**: calcul Haversine en km entre (lat, lon) utilisateur et station
- **Filtrage rayon**:
  - filtre strict après normalisation
  - ajoute une marge de 2 km pour compenser des imprécisions dataset
- **Ouvert maintenant**:
  - essaye d’inférer “openNow” via le champ `horaires` et le fuseau `Europe/Paris`
  - si données horaires non exploitables → `null`
- **Sélection de prix**:
  - `fuel=best`: prend le **meilleur prix** parmi les carburants disponibles
  - sinon: prend le prix du carburant demandé si présent
- **Tri**:
  - d’abord par distance croissante
  - puis par prix sélectionné croissant

### Format de réponse (extrait)

Réponse JSON:

- `{ stations: Station[] }`

Chaque station contient notamment :
- `id`, `name`, `adresse`, `cp`, `ville`
- `latitude`, `longitude`
- `distanceKm`
- `openNow` (boolean ou null)
- `selected` (carburant + prix + date maj éventuelle)
- `prices` (prix par carburant)

Source: `app/api/stations/route.ts` + mapping côté page `app/page.tsx`

## Cartographie

### MapLibre (implémentation utilisée)

Fichier: `components/maplibre-map.tsx`

- Basemap: tuiles raster **OpenStreetMap** `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- Style MapLibre v8 embarqué (pas de provider externe)
- Marqueurs “stations”:
  - couche cercle avec couleur selon “bucket” de prix (`cheap|ok|expensive|unknown`)
- Marqueur “moi”:
  - un halo + un point central
- Interactions:
  - clic sur une station → `onSelect(station)`
- Ajustement vue:
  - si stations visibles: `fitBounds` sur stations (+ position si connue)
  - sinon, si position: `easeTo` sur la position

### Leaflet (alternative disponible)

Fichier: `components/map.tsx`

- Basemap OSM, marqueurs `CircleMarker`
- Recentre la carte au changement de position et `fitBounds` sur stations
- Couleur des stations calculée comme pour MapLibre (vert/orange/rouge/gris)

## Commandes projet

Depuis la racine:

- **Dev**: `npm run dev`
- **Build**: `npm run build`
- **Prod**: `npm run start`
- **Lint**: `npm run lint`

Source: `package.json`

## Points d’attention / limites

- **Géolocalisation sur mobile**: nécessite HTTPS (ou localhost).
- **Dépendance externe**: le dataset gouvernemental peut être indisponible → l’API renvoie `502` (“Impossible de récupérer les stations.”).
- **Performance**: l’API peut charger beaucoup d’enregistrements (pagination). Le cache (10 min) réduit l’impact, mais un redéploiement/scale-out implique cache par instance.
- **Attribution OSM**: la carte utilise des tuiles OpenStreetMap et doit conserver l’attribution affichée.

## Assets statiques

- Dossier `public/`: contient des SVGs de template (`vercel.svg`, `file.svg`, `window.svg`).

