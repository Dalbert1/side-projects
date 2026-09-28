# Side Hustle Portfolio - Developer Guide

Complete documentation for developing, deploying, and maintaining this monorepo.

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Repository Structure](#repository-structure)
4. [Getting Started](#getting-started)
5. [Subproject Details](#subproject-details)
6. [Supabase Setup](#supabase-setup)
7. [Environment Variables](#environment-variables)
8. [GitHub Actions / Deployment](#github-actions--deployment)
9. [Adding a New Subproject](#adding-a-new-subproject)
10. [Code Standards](#code-standards)
11. [Common Tasks](#common-tasks)

---

## Overview

This is a monorepo hosting multiple Tulsa-focused MVP web applications deployed to GitHub Pages as a unified portfolio. Each subproject is an independent React app with its own dependencies, build config, and optional Supabase backend.

**Live URL pattern:** `https://<username>.github.io/side-projects/<project>/`

**Active projects:**
- `partyplug/` - **918 Party Co.** - Event services marketplace (bounce houses, DJs, caterers, etc.)
- `tulsahomehelp/` - **TulsaHomeHelp** - Home & property services marketplace (pressure washing, lawn care, etc.)
- `heelerconstruction/` - **Heeler Construction** - Construction company brochure site (Elk City, OK)

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| UI Framework | React | 19.2.4 |
| Build Tool | Vite | 8.0.1 |
| CSS | Tailwind CSS | 4.2.2 (via @tailwindcss/vite plugin) |
| Routing | React Router DOM | 7.13.2 |
| Icons | Lucide React | 1.7.0 |
| Database/Backend | Supabase | @supabase/supabase-js 2.100.1 |
| Deployment | GitHub Pages via GitHub Actions | Node 20 |
| Linting | ESLint | 9.39.4 |

**Note:** Tailwind CSS v4 uses the `@tailwindcss/vite` plugin rather than a `tailwind.config.js` file. Theme customization is done via `@theme` blocks in `src/index.css`.

---

## Repository Structure

```
side-projects/
  .github/
    workflows/
      deploy.yml              # GitHub Actions workflow - builds all projects and deploys
  docs/
    business-plan.txt         # Full business strategy document
    DEVELOPER_GUIDE.md        # This file
  partyplug/                  # 918 Party Co. (event marketplace)
    public/                   # Static assets (images served as-is)
    images/                   # Source images (not served, used for processing)
    src/
      components/             # Reusable UI components
      pages/                  # Route-level page components
      data/                   # Mock data (fallback when Supabase is not configured)
      lib/                    # API functions and Supabase client
    index.html                # Entry HTML
    package.json
    vite.config.js
    supabase-schema.sql       # Database schema + seed data
    .gitignore
  tulsahomehelp/              # TulsaHomeHelp (home services marketplace)
    (same structure as partyplug)
    supabase-schema.sql       # Uses thh_ prefix on all tables
  heelerconstruction/         # Heeler Construction (brochure site)
    public/images/            # Project photos and logo
    src/
      App.jsx                 # Single-file app (all components in one file)
      main.jsx
      index.css
    index.html
    package.json
    vite.config.js
    .gitignore
  CLAUDE.md                   # AI assistant instructions and project rules
```

---

## Getting Started

### Prerequisites

- Node.js 20+ (matches CI environment)
- npm (comes with Node)
- Git

### Clone and install

```bash
git clone https://github.com/Dalbert1/side-projects.git
cd side-projects
```

Each subproject manages its own dependencies. Install per-project:

```bash
# Install all three projects
cd partyplug && npm install && cd ..
cd tulsahomehelp && npm install && cd ..
cd heelerconstruction && npm install && cd ..
```

### Run a project locally

```bash
cd partyplug
npm run dev
# Opens at http://localhost:5173/side-projects/partyplug/
```

Available scripts (same for all projects):

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local dev server with hot reload |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |

### Local environment variables (partyplug and tulsahomehelp only)

Create a `.env` file in the project root:

```bash
# partyplug/.env (or tulsahomehelp/.env)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJI...your-anon-key
```

**Without these variables:** The apps fall back to mock data defined in `src/data/mockVendors.js` (or `mockProviders.js`). This means the apps work fine locally without Supabase - you just get hardcoded sample data.

**heelerconstruction does not use Supabase** and has no environment variables.

---

## Subproject Details

### 918 Party Co. (`partyplug/`)

Event and party services marketplace for the Tulsa area.

**Routes (HashRouter):**
| Route | Page | Description |
|-------|------|-------------|
| `/` | Home | Hero banner, categories, featured vendors, CTA |
| `/vendors` | Vendors | Searchable/filterable vendor listing |
| `/vendors/:id` | VendorDetail | Individual vendor with reviews and booking form |
| `/get-listed` | GetListed | Vendor registration form |

**Key components:**
- `Navbar.jsx` - Sticky nav with PartyPopper icon + "918 Party Co." branding
- `Footer.jsx` - Links, vendor CTA, copyright
- `BookingForm.jsx` - Booking request form (submits to Supabase `booking_requests`)
- `ReviewForm.jsx` / `ReviewCard.jsx` - Review submission and display
- `VendorCard.jsx` / `CategoryCard.jsx` - Card components for listings
- `SearchBar.jsx` - Search input component
- `StarRating.jsx` - Star rating display
- `ScrollToTop.jsx` - Scrolls to top on route change

**API layer (`src/lib/api.js`):**
- Checks `isConfigured` flag - if Supabase env vars are set, queries Supabase; otherwise returns mock data
- Exports: `fetchCategories`, `fetchVendors`, `fetchFeaturedVendors`, `fetchVendor`, `fetchReviews`, `submitBooking`, `submitReview`, `submitVendorListing`

**Theme colors (defined in `src/index.css` via `@theme`):**
- Primary: `#c2665a` (coral)
- Accent: `#e8a54b` (gold)
- Surface: `#fef8f0` (warm cream)

**Hero image:** `public/918-party.webp` - optimized from source PNG (29MB -> ~100KB via sharp, resized to 1920px wide, WebP quality 80)

### TulsaHomeHelp (`tulsahomehelp/`)

Home and property services marketplace.

**Routes:** Same pattern as partyplug but with "providers" instead of "vendors"
| Route | Page |
|-------|------|
| `/` | Home |
| `/providers` | Providers (filterable listing) |
| `/providers/:id` | ProviderDetail (reviews + quote form) |

**Supabase tables use `thh_` prefix** to avoid conflicts when sharing a Supabase project with partyplug. Tables: `thh_categories`, `thh_providers`, `thh_quote_requests`, `thh_reviews`.

**Theme:** Green/nature tones (check `src/index.css`).

### Heeler Construction (`heelerconstruction/`)

Static brochure site for a construction company in Elk City, OK. **No Supabase, no routing, no backend.**

**Single-file architecture:** Everything is in `src/App.jsx` - Navbar, Hero, Services, Gallery (with lightbox), Reviews, About, Contact, Footer, ScrollToTop.

**Key details:**
- Phone: 580-799-9191
- Email: Heelerconstructionllc@gmail.com
- Facebook: https://www.facebook.com/HeelerConstructionWelding/
- Services: New Builds, Interior Remodels, Exterior Remodels, Framing, Fencing
- **No welding references** (removed per client request)
- **Not licensed/insured** (removed per client request)

**Theme colors (defined in `src/index.css` via `@theme`):**
- Navy: `#1b3564` (primary dark blue)
- Accent: `#c9922e` (gold)
- Warm: `#f5f0e8` (cream background)

### 918 Lightyears (`lightyears/`)

A No Man's Sky style space exploration game. **Vite + Three.js, no React, no Supabase.** Deploys to `/side-projects/lightyears/`.

```bash
cd lightyears && npm install && npm run dev
# http://localhost:5173/side-projects/lightyears/
```

**Layout:**
- `src/world/` - seeded galaxy and star systems (`universe.js`), planet recipes, terrain height function and chunk builder (`planetgen.js`), terrain web workers
- `src/render/` - quadtree LOD planets, atmosphere/terrain/object shaders (`shaders.js`), clouds, rings, backdrop, ship/station/flora models, effects
- `src/game/` - the `Game` loop and state machine (`game.js`), ship flight, on-foot player, surface flora, fauna, mining, asteroids, NPC traffic, objectives, save
- `src/ui/` - input (touch stick, look drag, buttons, keyboard/mouse), HUD, menus, galaxy map
- `src/audio/` - synthesized music and sound (WebAudio, no files)

**Debug view:** `?debug&biome=lush&view=space|low|ground` renders a single planet. `?autostart=new` skips the title.

**Saves** live in `localStorage` under `lightyears918.save.v1`.

### 918 Blast Radius (`blastradius/`)

A NUKEMAP style nuclear blast simulator. Pick a real weapon (or any yield from 10 tons to 100 Mt), drop ground zero anywhere on a world map and see the blast rings, radiation, burns and a wind-driven fallout plume. **React + Vite + Tailwind + Leaflet, no Supabase.** Deploys to `/side-projects/blastradius/`.

```bash
cd blastradius && npm install && npm run dev
# http://localhost:5173/side-projects/blastradius/
```

**Layout:**
- `src/lib/effects.js` - the physics: blast, thermal and radiation radii (Glasstone & Dolan scaling) and the fallout contour model
- `src/data/weapons.js` - the weapon list with yields, fission share and blurbs
- `src/data/places.js` - Tulsa landmarks, regional towns and world cities used for quick targets, search and the "What's in range" list
- `src/components/MapView.jsx` - Leaflet map, ring and plume layers, detonation animation
- `src/lib/api.js` - Nominatim place search and reverse geocoding, Open-Meteo winds aloft (all free, no keys)

**Share links:** every detonation writes its setup to the URL hash (`#lat=..&lng=..&kt=..&b=a|s&w=weaponId...`). Opening a link with a hash sets the strike off automatically.

**Preferences** (units, map style, sound) live in `localStorage` under `blastradius918.*`.

---

## Supabase Setup

### Creating a Supabase project

1. Go to https://supabase.com and create a new project
2. Note your **Project URL** and **anon public key** from Settings > API

### Running the schema

Each project with Supabase has a `supabase-schema.sql` file. Run it in the Supabase SQL Editor (https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new).

**For 918 Party Co. (`partyplug/supabase-schema.sql`):**
- Creates tables: `categories`, `vendors`, `booking_requests`, `reviews`, `vendor_listings`
- Sets up Row Level Security (RLS) policies
- Seeds 8 categories, 10 sample vendors, 18 sample reviews

**For TulsaHomeHelp (`tulsahomehelp/supabase-schema.sql`):**
- Creates tables: `thh_categories`, `thh_providers`, `thh_quote_requests`, `thh_reviews`
- All tables prefixed with `thh_` to avoid conflicts
- Seeds 8 categories

**Both projects can share a single Supabase project** since TulsaHomeHelp uses the `thh_` prefix.

### Table overview

**918 Party Co. tables:**

| Table | Purpose |
|-------|---------|
| `categories` | Service categories (bounce houses, DJs, etc.) |
| `vendors` | Listed vendor businesses |
| `reviews` | Customer reviews linked to vendors |
| `booking_requests` | Booking form submissions from customers |
| `vendor_listings` | "Get Listed" registration form submissions |

**TulsaHomeHelp tables:**

| Table | Purpose |
|-------|---------|
| `thh_categories` | Service categories (pressure washing, lawn care, etc.) |
| `thh_providers` | Listed service providers |
| `thh_reviews` | Customer reviews linked to providers |
| `thh_quote_requests` | Quote request form submissions |

### RLS Policies

All tables have Row Level Security enabled:
- **SELECT** (public read): categories, vendors/providers, reviews
- **INSERT** (public write): booking_requests/quote_requests, reviews, vendor_listings
- **UPDATE** (authenticated owner only): vendors/providers can update their own listing

---

## Environment Variables

### Local development

Create a `.env` file in the project directory (partyplug or tulsahomehelp):

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJI...your-anon-key
```

These files are `.gitignore`d and never committed.

### GitHub Actions (for production builds)

Add these as **repository secrets** in GitHub:

1. Go to your repo > Settings > Secrets and variables > Actions
2. Add two repository secrets:
   - `VITE_SUPABASE_URL` - Your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` - Your Supabase anon/public key

The deploy workflow passes these to both partyplug and tulsahomehelp builds:

```yaml
env:
  VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
  VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
```

**HeelerConstruction does not need any secrets.**

### How the fallback works

In `src/lib/supabase.js`:
```js
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co'
```

In `src/lib/api.js`:
```js
const isConfigured = import.meta.env.VITE_SUPABASE_URL && !import.meta.env.VITE_SUPABASE_URL.includes('your-project')
```

If the URL is missing or contains the placeholder `your-project`, all API functions return mock data from `src/data/mockVendors.js` instead of querying Supabase.

---

## GitHub Actions / Deployment

### How it works

The workflow at `.github/workflows/deploy.yml` runs on every push to `main`:

1. Checks out the repo
2. Sets up Node 20
3. For each subproject: `npm ci` then `npm run build` (with env vars where needed)
4. Assembles all `dist/` folders into a `_site/` directory
5. Generates a root `index.html` landing page with links to all projects
6. Uploads to GitHub Pages via `actions/deploy-pages@v4`

### GitHub Pages setup (one-time)

1. Go to repo > Settings > Pages
2. Set **Source** to "GitHub Actions" (not "Deploy from a branch")
3. The workflow handles everything from there

### Vite base path

Each project's `vite.config.js` sets a `base` path matching the deployment subdirectory:

```js
// partyplug/vite.config.js
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/side-projects/partyplug/',
})
```

This is critical for assets (images, JS, CSS) to resolve correctly on GitHub Pages. All projects use `import.meta.env.BASE_URL` when referencing public assets.

### Manual deployment

You can trigger a deploy manually from the Actions tab > "Deploy to GitHub Pages" > "Run workflow".

---

## Adding a New Subproject

1. **Scaffold the project:**
   ```bash
   npm create vite@latest myproject -- --template react
   cd myproject
   npm install
   npm install lucide-react
   npm install -D @tailwindcss/vite tailwindcss
   ```

2. **Add Supabase (if needed):**
   ```bash
   npm install @supabase/supabase-js
   ```

3. **Configure `vite.config.js`:**
   ```js
   import { defineConfig } from 'vite'
   import react from '@vitejs/plugin-react'
   import tailwindcss from '@tailwindcss/vite'

   export default defineConfig({
     plugins: [react(), tailwindcss()],
     base: '/side-projects/myproject/',
   })
   ```

4. **Set up Tailwind v4 in `src/index.css`:**
   ```css
   @import "tailwindcss";

   @theme {
     --color-primary: #your-color;
     /* ... */
   }
   ```

5. **Update the deploy workflow** (`.github/workflows/deploy.yml`):

   Add build steps (before the "Assemble site" step):
   ```yaml
   # -- Build MyProject --
   - name: Install MyProject deps
     run: npm ci
     working-directory: myproject

   - name: Build MyProject
     run: npm run build
     working-directory: myproject
     env:  # only if using Supabase
       VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
       VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
   ```

   Add to the assemble step:
   ```yaml
   cp -r myproject/dist _site/myproject
   ```

   Add to the generated index.html:
   ```html
   <a href="./myproject/">MyProject <span class="tag">-- Description</span></a>
   ```

6. **Commit and push** - the workflow will build and deploy automatically.

---

## Code Standards

### General rules (from CLAUDE.md)

- **Mobile-first responsive design** - always test on small screens
- **Tulsa-specific branding** - no generic names; everything should feel local
- **Never use em dashes** (--) in user-visible text - use a single hyphen with spaces (` - `) instead. Double dashes in text are a giveaway for AI-generated content
- **Ship fast** - these are MVPs, not polished products

### Tailwind CSS v4

- No `tailwind.config.js` file - configuration is done in CSS via `@theme` blocks
- Plugin is `@tailwindcss/vite` (not `@tailwindcss/postcss`)
- Custom colors defined as CSS custom properties in `@theme`

### Component patterns

- Lucide React for all icons (never raw SVGs unless the icon doesn't exist in lucide, like Facebook)
- `no-underline` class on all `<a>` and `<Link>` elements
- `cursor-pointer` on interactive non-link elements
- Forms use controlled components with `useState`

### API pattern

Each project with a backend follows this pattern:
- `src/lib/supabase.js` - Supabase client initialization
- `src/lib/api.js` - All data functions, with `isConfigured` check for mock fallback
- `src/data/mock*.js` - Hardcoded sample data used when Supabase is not configured

### Image optimization

For large images (hero banners, etc.):
1. Keep source files in `images/` directory (not served)
2. Convert to WebP and resize to max 1920px wide using sharp:
   ```bash
   npm install --no-save sharp
   node -e "import('sharp').then(m => m.default('images/source.png').resize(1920).webp({quality:80}).toFile('public/output.webp').then(console.log))"
   npm uninstall sharp
   ```
3. Place optimized files in `public/` (served as static assets)
4. Reference with `${import.meta.env.BASE_URL}filename.webp`

---

## Common Tasks

### Run all builds locally (verify before pushing)

```bash
cd partyplug && npm run build && cd ..
cd tulsahomehelp && npm run build && cd ..
cd heelerconstruction && npm run build && cd ..
```

### Check deployment status

Go to the repo's Actions tab on GitHub to see workflow runs and any build failures.

### Update Supabase schema

1. Edit the `supabase-schema.sql` file in the relevant project
2. Run the new/changed SQL in the Supabase SQL Editor
3. Commit the updated schema file

### Add a new vendor/provider via SQL

```sql
INSERT INTO vendors (name, category_id, description, image_url, rating, review_count, price_range, location, phone, featured, services)
VALUES (
  'Business Name',
  'category-id',
  'Description text',
  'https://image-url.com/photo.jpg',
  4.5, 0, '$$', 'Tulsa, OK', '(918) 555-0000', false,
  ARRAY['Service 1', 'Service 2']
);
```

### Force a redeploy without code changes

Go to Actions > "Deploy to GitHub Pages" > "Run workflow" > "Run workflow" button.
