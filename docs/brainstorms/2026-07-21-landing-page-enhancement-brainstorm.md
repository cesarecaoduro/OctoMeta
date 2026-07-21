---
date: 2026-07-21
topic: landing-page-enhancement
status: approved
---

# Landing Page Enhancement

## What We're Building

Refine the OctoMeta landing page around one memorable proof: changing an engineering input updates the calculation, report, and private-beta 3D geometry as one living document, with the same verified model delivered through IFC. Preserve the existing engineering-drawing visual language, brand tokens, and interactive footing demo while shortening the path from proposition to evidence to early-access signup.

This is an editorial compression and usability pass, not a visual rebrand. The proposed page should feel precise, calm, and product-led: generous space, clear hierarchy, familiar engineering concepts, restrained computation-driven motion, and no decorative effects that contradict `DESIGN.md`. Its position is deliberately anti-hype: OctoMeta is an engineering tool first, built for predictable results, quality, traceability, and verification. AI does not lead the story.

## Why This Approach

### Recommended: Product Proof

Use the live demo as the organizing idea, combine overlapping capability sections, add credible product evidence, and move a lightweight conversion opportunity closer to the demonstration.

**Pros:** strengthens differentiation; reduces repetition; improves mobile pacing; brings proof and conversion closer together.

**Cons:** requires copy and information-architecture decisions, not just CSS refinement.

### Alternative: Precision Polish

Keep the current structure and focus on accessibility, touch targets, typography, spacing, and token compliance.

**Pros:** lowest scope and least content risk.

**Cons:** leaves the roughly 10,766 px mobile journey and late signup placement largely unchanged.

### Alternative: Guided Computation Story

Turn the demo into a staged input → graph → report → geometry → export narrative.

**Pros:** highly memorable and differentiated.

**Cons:** greater implementation and motion complexity; risks conflicting with the prohibition on scroll-jacking and decorative animation.

## Proposed Story

1. **Promise** — “The living engineering document” with a specific outcome and primary CTA.
2. **Proof** — the footing demo, paired with a direct instruction to change the width.
3. **Outcome strip** — calculate with units, review with provenance, deliver PDF/IFC from the same graph.
4. **Why it matters** — a concise stale-artifact problem statement with sourced evidence.
5. **How it works** — one graph diagram plus three consolidated capability chapters.
6. **Trust** — predictable computation, traceable decisions, verifiable outputs, launch scope, and clearly labelled “Coming soon” items.
7. **Early access** — email-first signup; collect role, firm size, and tool context after the initial commitment or make them optional.

The repeated navigation CTA remains, and a second quiet CTA appears immediately after the demo.

## Key Decisions

- **Preserve the brand system:** paper surface, Inter Tight/Inter/JetBrains Mono, dimension dividers, accent punctuation, and violet computation signals remain authoritative.
- **Product remains the hero:** no stock imagery, mascot, decorative gradient, or generic feature-card wall.
- **Engineering certainty is the position:** communicate familiarity with the engineering design process and make quality, traceability, verification, and predictable behavior the non-negotiable product promise.
- **Geometry and IFC define the beta:** live 3D geometry and IFC delivery are primary private-beta differentiators, not tentative roadmap footnotes.
- **AI does not lead:** MCP and AI appear only as restrained “Coming soon” capabilities. They must not displace the core engineering workflow or imply that probabilistic behavior governs calculations or verification.
- **Apple principles, not Apple imitation:** apply hierarchy, clarity, adaptability, 44 × 44 pt touch targets, readable text, and progressive disclosure without importing Liquid Glass or platform chrome into the web brand.
- **Motion communicates computation:** keep recompute flashes and dependency pulses; remove or reduce generic entrance reveals where they add delay without meaning.
- **Progressive disclosure:** reduce MCP and AI to a concise “Coming soon” note; defer technical detail to future product documentation.
- **Evidence before claims:** source prominent statistics or replace them with demonstrable product facts.
- **Mobile is a first-class composition:** compact the demo and target a materially shorter journey rather than merely stacking desktop sections.

## Compliance Fixes Included in Any Direction

- Add a skip link to the main content.
- Replace `transition: all` with explicit properties.
- Restore an explicit `:focus-visible` treatment on waitlist controls.
- Announce async form errors with `aria-live` and associate them with the form.
- Increase the range input’s usable touch target to at least 44 × 44 CSS px.
- Ensure scroll-revealed content remains available when observers or motion fail.
- Apply `text-wrap: balance`/`pretty` where appropriate.
- Remove shadows prohibited by `DESIGN.md`; use borders and surface shifts for elevation.
- Stop using `--accent-2` outside the logo and reconcile token drift with `DESIGN.md`.
- Use documented radius and spacing tokens instead of one-off values.

## Success Criteria

- A first-time visitor can explain OctoMeta’s core loop after viewing the hero and demo.
- A first-time visitor understands that OctoMeta prioritises predictable engineering workflows, quality, traceability, and verification over AI hype.
- 3D geometry and IFC are clearly presented as private-beta capabilities and primary differentiators.
- MCP and AI are clearly subordinate and labelled “Coming soon.”
- The primary product proof appears in the first narrative chapter on desktop and mobile.
- Mobile page length is reduced by approximately 35–45% without hiding essential information.
- A waitlist opportunity appears directly after the demo and again at the end.
- Interactive targets meet the 44 × 44 px minimum, keyboard focus is obvious, and reduced-motion mode exposes all content.
- Every prominent quantitative claim is sourced or removed.
- The implementation contains no off-brand gradients, decorative motion, forbidden shadows, or accent-token misuse.
- The page passes the project’s Svelte checks and an automated accessibility scan, followed by desktop and narrow-screen visual verification.

## Chosen Direction

- **Product Proof**, centred on engineering certainty, 3D geometry, and IFC delivery.

## Next Steps

Use `docs/plans/2026-07-21-feat-product-proof-landing-page-plan.md` as the implementation and verification contract.
