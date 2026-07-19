# OctoMeta — Competitive Landscape & Pricing (v1)

_Consolidated from 2026 research. Companion deck: `competitive-deck.html`._

---

## 1. Market map

Four clusters converge on the engineering-calculation document, none covering it whole:

1. **Calc-document tools** — CalcTree, Blockpad, PTC Mathcad Prime, Open Calculations Studio: readable calcs and units, no real geometry, no (or nascent) BIM output.
2. **Structural calc suites** — SkyCiv, ClearCalcs, Tedds: code-checked templates and reports, closed libraries, not a general computational document.
3. **Reactive notebooks** — Observable, Marimo, Pluto.jl: solved order-independence (our document model's ancestor), but no units, no geometry, no deliverable.
4. **Horizontal giants** — Excel (+Python, +Copilot), Notion/Coda: distribution and AI momentum, hidden logic, no units, no geometry, no IFC.
5. **Parametric geometry** — Grasshopper/Dynamo: the geometry we want, none of the document we need.

## 2. Competitor profiles (condensed)

| Competitor                                                          | What it is                                                                                                         | Strengths                                                                    | Weaknesses vs OctoMeta                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **CalcTree** (~A$3.8M pre-seed 2025; Arup/Jacobs/Aurecon/WSP users) | Cloud calc pages: MathJS + Python, templates, collab, GraphQL, Grasshopper/Excel/ETABS plugins, AI generate/verify | Collaboration, AI momentum, enterprise traction, Standards Australia backing | No native geometry, no live 3D, no IFC; params-on-pages, not a typed reviewable graph        |
| **Blockpad**                                                        | Word-processor calc docs; `=` opens math-notation formulas; units intelligence; named values; 2D CAD sketches      | Best-in-class units UX, readable calcs, loved by users, cheap                | 2D only, no B-Rep/IFC, no AI, desktop-first, weaker grid                                     |
| **PTC Mathcad Prime 12**                                            | The desktop incumbent for natural-notation math                                                                    | Trust, depth, unit systems, Creo link                                        | Desktop, expensive, no geometry-from-calc, no IFC, weak collab                               |
| **SkyCiv / ClearCalcs / Tedds**                                     | Code-checked structural calc suites with report output                                                             | Verified template libraries, code clauses beside calcs                       | Closed libraries, not general documents, no parametric geometry                              |
| **Excel + Python + Copilot**                                        | The universal baseline; `=COPILOT`, Agent Mode                                                                     | Ubiquity, muscle memory, AI investment                                       | Hidden logic, no units, no geometry/IFC, order/hidden-state failures — our problem statement |
| **Observable / Marimo / Pluto**                                     | Reactive notebooks; DAG-determined execution                                                                       | Solved out-of-order execution (we borrow this)                               | No units, no geometry, no engineering deliverable, no grid UX                                |
| **Grasshopper / Dynamo**                                            | Visual parametric geometry                                                                                         | Geometry power, ecosystems                                                   | Node canvas ≠ calc document; no unit-safe reviewable report                                  |
| **Open Calculations Studio** (OpenAEC, ex-CalcPAD; v0.1.x)          | OSS Rust/Tauri calc docs with **live IFC4x3 export**                                                               | Validates calc→IFC thesis; open-source energy                                | Desktop, CalcPAD syntax, no dependency graph, no 3D B-Rep, no AI — but **watch closely**     |

## 3. The five pillars nobody else combines

1. **Geometry as a first-class value** in the calc graph — live 3D exact B-Rep from formulas.
2. **The report IS the deliverable** — PDF + IFC4X3 from one graph (only OCS approaches this, early and desktop-bound).
3. **Real spreadsheet UX** bound to a typed, unit-safe, reviewable graph.
4. **Notebook semantics with order-independence by construction** — applied to engineering values, which the notebooks that invented it lack.
5. **AI-ready by architecture** — one mutation API + provenance; honest that AI features ship later.

**Table stakes to match early:** units parity with Blockpad/Mathcad, show-steps, seeded template library, XLSX import, code clauses beside calcs. **Where they're ahead:** maturity/trust (Mathcad, Tedds), collaboration (CalcTree — ours lands M5), AI shipping today (CalcTree, Copilot — ours M6), distribution (Excel).

## 4. Pricing landscape (verified 2026, indicative)

| Product          | Price point                                                | Notes                                             |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| CalcTree         | Free · **$24–34 /user/mo** Business · Enterprise custom    | Own site shows both figures; ~15% annual discount |
| Blockpad         | ~**$18 /mo**                                               | Positioned "4× cheaper than Mathcad"              |
| Mathcad Prime    | ~**$735–860 /yr** (≈$61–72 /mo) individual                 | Subscription only                                 |
| ClearCalcs       | **$35–119 /mo**                                            | Tiered by codes/templates                         |
| SkyCiv           | ~$1,250 /yr Professional (≈$104 /mo) · $179 month-to-month | FEA suite, heavier product                        |
| Tedds (Trimble)  | Quote-based, typically >$1k /yr/seat                       | Enterprise library sell                           |
| Excel + Copilot  | M365 + **~$21 /user/mo** Copilot add-on                    | The psychological anchor                          |
| Open Calc Studio | **Free** (LGPL)                                            | Pressure on the low end of calc-docs              |

**Reading the market:** calc-document value clusters at **$18–35/user/mo**; verified-template suites command $35–120; Mathcad's ~$65/mo equivalent is the ceiling engineers already tolerate for a _single-purpose_ tool. Our differentiators (live B-Rep geometry + IFC deliverable) sit in territory customers currently pay a _second_ tool for — that justifies pricing at the top of the calc-doc band, not inside the suite band, while adoption is the goal.

## 5. Recommended pricing

| Tier           | Price                         | Includes                                                                                                                                               | Rationale                                                                                                                                                |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explorer**   | **$0**                        | Single user, 3 active documents, full graph/units/geometry, PDF export with OctoMeta footer, community templates                                       | The demo is the funnel; geometry must be _felt_ free. Counters OCS-free pressure                                                                         |
| **Pro**        | **$29 /user/mo** ($24 annual) | Unlimited documents, IFC4X3 export, show-steps in exports, template library, XLSX import, version history                                              | Head-to-head with CalcTree Business ($24–34) while carrying two capabilities they lack (3D + IFC). Annual price lands exactly on their discounted anchor |
| **Team**       | **$49 /user/mo** ($41 annual) | Everything in Pro + real-time collaboration, sharing/permissions, verification workflow (provenance queries, verified badges), org template governance | Priced under ClearCalcs' upper tiers; the checker/ISO 19650 story is the upsell. Ships with M5                                                           |
| **Enterprise** | Custom                        | SSO, audit exports, on-prem discussion, standards packs, priority kernels                                                                              | Standard motion; gated on M5+                                                                                                                            |

**Launch motion:** waitlist → private beta free → **Founding Engineer offer**: Pro at **$19/user/mo locked for 24 months** for beta participants who convert. AI features (M6) launch as a Pro/Team _included_ capability, not a paid add-on — architecture-native AI is a differentiator claim, and unbundling it would undercut the story.

**Price-integrity rules:** never compete on price with OCS (compete on web + grid + graph + 3D); never price above Mathcad-equivalent (~$65/mo) for a single seat; revisit when IFC round-trip (import) ships — that feature can carry a tier of its own.

## 6. Connectivity — grounded in what exists today

**Verified facts (July 2026).** Autodesk Platform Services publishes **official MCP server samples** for its AEC Data Model API on the `autodesk-platform-services` GitHub org: `aps-aecdm-mcp-dotnet` (.NET, STDIO transport, PKCE auth; tools `GetToken`, `GetHubs`, `GetProjects`, `GetElementGroupsByProject`, `GetElementsByElementGroupWithCategoryFilter`, plus Viewer element highlighting; endpoint `developer.api.autodesk.com/aec/graphql`; MIT), `aps-mcp-app-example` (JavaScript, Streamable HTTP, MCP Apps, Viewer integration), and `aps-mcp-server-python` (2LO/SSA/3LO auth patterns), together with an official APS best-practices guide for building custom MCP servers. The underlying AEC Data Model API is a GA GraphQL API giving cloud access to granular Revit design data on ACC without plugins. These are _samples and guidance_, not a packaged Autodesk product — describe them accurately in all materials.

**What we build on it — two focused examples, nothing speculative:**

1. **Model data (Revit via APS).** OctoMeta consumes the APS MCP-server pattern to bind an element property as a named value: `footing.width ← Tower-B.rvt · footing F3 · width`. The value enters the graph typed and provenance-stamped (source, query, pull time); re-pulling recomputes everything downstream.
2. **Cost data (ERP via MCP).** Any MCP server a firm runs in front of its ERP serves the same pattern: `rates.concrete ← erp · unit_rate("N40 mix")`, so `cost = VOLUME(footing) × rates.concrete` sits in the same unit-checked, reviewable graph as the engineering.

**Scope honesty / roadmap.** First connectors are read-only (APS + generic MCP), targeted M4–M5. Exposing the document graph as its own MCP server is roadmap (M6), built on the existing mutation API. No other connectors are claimed until a supported API path and test access exist.

**Competitive read.** CalcTree's integrations are plugin round-trips (Excel/Grasshopper/ETABS); no calc-document competitor treats external AECO or ERP data as typed graph inputs with provenance. Positioning line: **"Connect your AECO tools and ERPs. Stop retyping your own model."**
