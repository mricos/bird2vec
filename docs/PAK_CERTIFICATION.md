# bird2vec — Certification Notes for 3rd-Party Tetra Pak

This doc captures what was needed to turn bird2vec (a standalone SPA) into
a loadable Tetra Pak, and what additional documentation would help future
third-party authors follow the same path.

## What a certified pak needs (today, per TPA spec)

Authoritative spec: `devops/tetra/docs/specs/TPA_TETRA_PAK_AUTHORING.md`.

Minimum checklist:

1. **`pak.toml` at repo root** with `[pak]`, `[iframe]`, `[mounts.*]`.
2. **One `*.iframe.html`** reachable through the primary mount — should
   carry the SDC self-doc header (`docs/specs/SDC_Self_Doc_Convention.md`).
3. **`pak.json`** committed alongside — output of `tetra pak build`. Tetra
   only reads the JSON at runtime.
4. **Unique `name`** — cannot collide with built-in iframes (see
   `server/api/iframes.js` `DEFAULT_IFRAMES`).
5. **`minRole`** declared — gates visibility via entitlement lookup.
6. **Optional `[infrastructure]`** (per TPB) declaring tier:
   `static | api | mount | service | realtime`.

Install path for a local dev pak:

```
ln -s ~/src/bird2vec ~/.tetra/dev-paks/bird2vec
cd ~/src/bird2vec && tetra pak build   # emits pak.json
# restart tetra server
```

## What bird2vec currently ships

| File                           | Role                                        |
|--------------------------------|---------------------------------------------|
| `pak.toml`                     | Manifest (source of truth)                  |
| `tetra/bird2vec.iframe.html`   | Iframe entry, Level-1 Terrain integration   |
| `index.html` + `js/` + `css/`  | Existing SPA, mounted at `/bird2vec/`       |
| `tsm/env.toml` + `tsm/b2v.tsm` | Optional standalone TSM service (port 6201) |

Still missing before it counts as fully certified:

- [ ] `pak.json` — run `tetra pak build` to generate.
- [ ] SHA/signature — requires TPA signing step (v2, unsigned-with-warning OK for v1).
- [ ] TrellisCli command catalog — `[commands]` block + a `commands.js`
      export (would let users type `@bird2vec generate` from anywhere).
- [ ] Schema endpoint — if a backing `/api/bird2vec/*` is added later, it
      should return `apiRoutes`, `commands`, `userRole` per TIC.

## Documentation gaps — suggestions for the tetra docs set

These would materially help future 3rd-party authors:

### 1. `TPA_3RD_PARTY_CERTIFICATION.md` (new spec)

A checklist-style companion to TPA covering the *certification* path
distinct from authoring:

- Who signs paks (publisher key handling).
- Registry submission flow (ties into TPB).
- Compatibility matrix (tetra version → schemaVersion).
- Security review expectations (bash modules, service ports, secrets handling).
- Revocation: what happens when a signed pak is pulled from the registry.

### 2. `TPA_QUICKSTART.md` (tutorial, not spec)

A 10-minute walkthrough showing the bird2vec transformation end-to-end:
"here is a standalone web app, here are the six files you add to make it
a pak, here is how you install and test it." Currently TPA is reference
material; a narrative quickstart is missing.

### 3. Extend `SDC_Self_Doc_Convention.md`

Add a section: "Self-doc for pak iframes" showing the exact header block
pak authors should paste at the top of `*.iframe.html`. Include the
DISCOVERY link pointing back to `pak.toml` so anyone landing on the
iframe file can walk up to the manifest.

### 4. `PAK_DIRECTORY_CONVENTIONS.md` (new)

TPA leaves most directory layout open. A conventions doc would codify:

- `tetra/` — pak-level entry points (iframes, wrappers).
- `docs/` — pak-local documentation (including this file).
- `tsm/` — optional TSM service files (`env.toml`, `*.tsm`).
- `services/`, `bash/`, `assets/` as per current TPA example.
- Where to put tests (`tests/`) and fixtures — currently unspecified.

### 5. Schema-endpoint guidance for API-tier paks

If a pak declares `[routes.api]`, readers need to know it should follow
the tetra schema convention (`/api/<mod>/schema` returning
`apiRoutes` / `commands` / `userRole`). Document this requirement in
TPA's `[routes.*]` section, not just in TIC.

### 6. Discovery breadcrumbs

Top-level `README.md` of any pak should carry a one-line badge:

```
[![Tetra Pak](https://img.shields.io/badge/tetra--pak-v1-blue)](https://tetra.dev/paks)
```

…plus a `## Tetra Integration` section pointing to `pak.toml` and the
effective install command. Make this a recommendation in TPA §Discovery.

### 7. `pak doctor` / validator CLI

`tetra pak validate` exists for built-in paks. Third-party paks would
benefit from a `tetra pak doctor ./` that walks the manifest, checks
every referenced file, tests the iframe URL, pings declared services,
and reports a clean/dirty verdict. Document the exit codes so CI can use it.

## Open questions surfaced by this exercise

1. **Where should notebooks live?** bird2vec has `.ipynb` files in
   `config/`. TPA has no notebook convention. Should they be exposed via
   a `notebook.html` iframe, a separate `[notebook]` block, or ignored?

2. **External API keys.** bird2vec's Xeno-Canto key is prompted from
   the UI. TPA's `[services.*] env` block handles server-side secrets,
   but there's no guidance for iframe-side user-supplied keys.

3. **Jupyter/Python runtime.** bird2vec's generators currently run in
   the browser, but future versions could call into a Python service.
   Would that be a `service`-tier pak? A new `python` service kind?

4. **Asset weight.** The repo has no model weights today (harmonic
   synth is deterministic). If a pak ships large weights, the spec
   should say whether they go inside the pak dir, into a CDN, or via
   a signed-URL mount.
