# Crux Founder Business Plan — Design Specification

**Date:** 2026-07-11  
**Status:** Approved for specification review  
**Audience:** Crux's solo founder, with secondary readability for future partners or investors

## Purpose

Create a self-contained, multi-page HTML business plan that helps the founder decide what Crux should do next. The plan is an operating manual, not a fundraising deck: it must connect the current state of a barely launched open-source project to a credible path toward adoption, revenue, and later validation of the certified-specialist thesis.

The plan must answer:

- What valuable assets does Crux already have, and what is still unproven?
- Which customer problems are urgent enough to pay for?
- Which initial customer segment and use case should Crux pursue?
- What is the smallest paid product consistent with the open-source vision?
- How can a solo technical founder obtain initial users without capital or an existing audience?
- What does a design partnership mean in concrete operational terms?
- Which milestones justify building specialization, distillation, or reinforcement-learning infrastructure?
- Which signals should cause the founder to continue, change direction, or stop?

## Product Principle

The document must remain useful if the long-term specialization thesis proves wrong. It therefore separates:

1. the immediate need to establish adoption for Crux's current harness-engineering product;
2. the nearer commercial opportunity in reliability, evaluation, and governed evidence;
3. the long-horizon opportunity to compile production evidence into certified specialist models.

The plan must not imply that the founder should build training orchestration before users demonstrate demand and provide suitable workloads.

## Format

The artifact lives under `docs/business-plan/` and consists of real static HTML pages with shared CSS and minimal progressive-enhancement JavaScript.

- No framework, package installation, build step, analytics, or external runtime dependency.
- Pages work when opened through a simple local HTTP server.
- Core reading and navigation work without JavaScript.
- External market claims link to dated sources.
- The site is separate from the public Next.js documentation application.
- The content is responsive, keyboard-accessible, printable, and usable at 375 px through wide desktop layouts.

Proposed structure:

```text
docs/business-plan/
  index.html
  current-position.html
  market.html
  audience.html
  product.html
  go-to-market.html
  business-model.html
  roadmap.html
  founder-playbook.html
  metrics-risks.html
  sources.html
  assets/
    styles.css
    plan.js
```

Every page must use relative links so the artifact remains portable.

## Information Architecture

### Start

#### 1. Command Center (`index.html`)

A living executive surface rather than a ceremonial summary. It includes:

- current position;
- working near-term wedge;
- long-horizon thesis;
- strongest evidence and largest unknowns;
- next three founder actions;
- current decision gate;
- a concise navigation map for the rest of the plan.

### Learn

#### 2. Current Position

- Existing Crux packages, Quality system, observability, Project Index, local runtime, documentation, and OSS positioning.
- Honest maturity assessment: substantial technical surface, negligible distribution, no proven ICP, limited external proof.
- Assets, liabilities, constraints, and unfair advantages.
- Gap between current public positioning and the specialization horizon.
- Explicit warning that additional implementation is not the primary bottleneck.

#### 3. Market Evidence

- Customer pains: frontier-model cost, latency, unreliable task behavior, weak production feedback loops, dataset construction, evaluation leakage, deployment risk, and governance.
- Market structure: model providers, training/inference platforms, evaluation/observability tools, and vertical applications.
- Competitor analysis covering at least Fireworks, Together AI, OpenPipe/CoreWeave, Predibase/Rubrik, LangSmith, Braintrust, and Arize/Phoenix.
- Dated vendor-reported production evidence, clearly identified as vendor claims.
- Bottom-up market scenarios instead of unsupported top-down TAM claims.
- Why training compute is commoditized and why evidence/certification may remain valuable.

#### 4. Target Customer

- Ranked segments by urgency, budget, accessibility to a solo founder, and fit with Crux.
- Recommended beachhead: AI-native B2B software teams with one high-volume, measurable model workflow.
- Buyer/user map: founder or CTO, AI/ML lead, product engineer, and operational stakeholder.
- Qualification checklist and anti-personas.
- Jobs to be done and triggering events.
- Concrete initial use cases, while keeping personalized consumer models and industrial vision out of the initial wedge.

### Decide

#### 5. Product Thesis

Three horizons:

1. **Crux OSS:** deterministic, observable, evaluated harness engineering.
2. **Reliability/evidence product:** production evidence, datasets, certification, comparison, and promotion workflows.
3. **Certified Specialists:** method-aware choice among retrieval, prompting, SFT, preference tuning, and RFT using external providers.

The page defines the commercial object as a **Specialist**—one bounded job with a task contract, evidence, evals, model or adapter, deployment policy, and certification history.

It must explain what remains in the harness versus what can move into weights. Mutable facts and permissions remain outside weights.

#### 6. Go-to-Market Strategy

An attainable solo-founder motion:

- open-source discovery and trust;
- one undeniable, narrow flagship demonstration;
- founder-led problem interviews;
- three to five design partners;
- public learning through technical writing, examples, integrations, and case studies;
- partnerships with model/training providers only after the workflow is validated;
- a gradual transition from bespoke help to repeatable product.

The plan must prioritize activities by expected learning or adoption value and explicitly reject broad content calendars, paid advertising, conference sponsorship, and enterprise outbound at the present stage.

#### 7. Business Model

- OSS core remains free and useful without a hosted account.
- Early revenue comes from fixed-scope design-partner or specialization/reliability engagements.
- Later recurring revenue comes from an optional hosted or VPC control plane for evidence, certification, production monitoring, model comparisons, and promotion workflows.
- Customers bring and pay their own training/inference providers; Crux does not depend on GPU markup.
- Preferred value metric: active certified Specialists plus monitored production decisions, not training tokens.
- Pricing is presented as hypotheses and ranges to test, not established willingness to pay.
- Include bootstrapped, sustainable, and venture-scale revenue scenarios without fabricated forecasts.

### Execute

#### 8. Roadmap and Decision Gates

The roadmap begins at Crux's current state and is organized by evidence milestones rather than shipping volume.

- **Now–30 days:** sharpen installation/onboarding, create one flagship proof, conduct interviews, and recruit a first design partner.
- **30–90 days:** deliver design-partner outcomes, measure repeated pain, publish case evidence, and identify the repeatable workflow.
- **3–6 months:** package the repeatable reliability workflow, charge for pilots, and test a lightweight shared control plane only where manual work repeats.
- **6–12 months:** decide whether to deepen the reliability product, begin governed dataset export, or validate one-shot specialization.
- **12–24 months:** build provider-neutral specialization only if customer and data gates pass.

Each phase includes entry criteria, work, success evidence, revenue expectations as hypotheses, and stop/pivot gates.

#### 9. Founder Playbook

This page must teach the founder how to start high-touch design partnerships:

- where to find candidate teams;
- how to create a prospect list without paid tooling;
- outreach messages that ask about the problem rather than sell a platform;
- a 30-minute interview script;
- how to qualify a workflow;
- the shape of a two- to four-week pilot;
- free versus paid pilot criteria;
- deliverables, boundaries, and success metrics;
- how to ask for a testimonial, case study, referral, and paid continuation;
- weekly time allocation for building, conversations, support, and public proof.

Templates must be usable as written but clearly marked as starting points.

#### 10. Metrics and Risks

- A small founder scorecard: successful installs, time to first useful trace/eval, activated projects, repeat weekly use, interviews, design partners, paid pilots, retained workflows, and documented outcomes.
- Avoid vanity metrics such as repository stars without activation.
- Assumption ledger with confidence and validation method.
- Risks: provider bundling, falling frontier costs, overbuilding, insufficient data, TypeScript-only reach, enterprise distraction, services trap, model liability, privacy, and unclear category language.
- Mitigation and invalidation signals for each major risk.

### Appendix

#### 11. Sources and Assumptions

- Dated bibliography with direct links.
- Source type and caveats: primary documentation, vendor case study, research paper, or founder assumption.
- Clear distinction between observed facts, vendor-reported outcomes, inferences, and hypotheses.
- “Last researched” date of 2026-07-11.

## Page Content Contract

Every substantive page includes:

- a concise page thesis;
- evidence versus assumptions;
- an opinionated recommendation;
- a concrete founder action;
- one or more decision gates or success measures;
- links to relevant sources or the sources appendix.

The writing is direct, sober, and candid. It may be ambitious but must not use inflated market language or present roadmapped capabilities as shipped.

## Visual Design

- Crux-adjacent technical/editorial presentation.
- Neutral charcoal and light surfaces with the existing restrained teal accent.
- System sans-serif for body copy and system monospace for labels, metrics, and technical artifacts; no remote font dependency.
- Persistent left sidebar on desktop; compact top navigation/menu on small screens.
- Readable content width of roughly 65–75 characters for prose.
- Cards, tables, and restrained diagrams use Crux's snap-notch/block motif where useful.
- Dark and light themes use semantic CSS tokens and respect system preference; a theme control may be progressively enhanced.
- Motion is minimal, functional, and disabled under `prefers-reduced-motion`.
- Charts include adjacent text/table interpretation and never rely on color alone.
- Print styles remove navigation and controls, expand links where useful, and preserve page hierarchy.

Avoid gradients associated with generic AI branding, excessive glass effects, decorative animations, stock imagery, emoji icons, and dashboard-like metric theatre.

## Technical Behavior

- Semantic HTML landmarks and sequential heading hierarchy.
- A skip link and visible keyboard focus states.
- Current-page navigation uses `aria-current="page"`.
- Mobile navigation remains operable by keyboard and screen reader.
- JavaScript is optional and limited to progressive enhancements such as theme selection and small-screen navigation.
- No client-side rendering of primary content.
- No data collection or network requests beyond user-initiated external source links.
- Missing or disabled JavaScript leaves every page readable and reachable.

## Verification

Implementation is complete when:

1. every page exists and is reachable from every other page through the shared navigation;
2. all relative links and asset paths resolve under a local static server;
3. cited external sources are present and claims are labeled by evidence quality;
4. the site is visually inspected at approximately 375 px, 768 px, and desktop width;
5. keyboard navigation, focus order, skip link, and mobile menu are usable;
6. the site remains readable with JavaScript disabled;
7. light, dark, reduced-motion, and print presentations are checked;
8. no horizontal overflow occurs at the supported widths;
9. the roadmap reflects the current barely launched OSS position and constrains work through decision gates;
10. the founder playbook contains actionable scripts and a practical first-customer process;
11. repository checks confirm no unrelated files or generated build artifacts were added.

## Out of Scope

- Publishing the plan into the public docs navigation.
- A dynamic SaaS dashboard or live data integration.
- Authentication, analytics, databases, CMS, or remote APIs.
- A financial model presented as a forecast.
- Implementation of the Specialist product itself.
- Changes to current Crux runtime or package APIs.

