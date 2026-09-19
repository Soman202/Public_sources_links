# Glossary: Renewable Curtailment & Constraint in Ireland's Grid
*A leveled guide for a physics background, no prior power-systems knowledge assumed.*

Terms are grouped from **foundational** (things you need before anything else makes sense) to **highly specialized** (terms that only show up deep in this specific paper). Within each level, terms build on each other roughly in reading order.

---

## Level 1 — Absolute Basics (grid vocabulary)

| Term | Definition |
|---|---|
| **Generator** | Anything feeding electrical power into the grid — a wind turbine, gas plant, solar farm, etc. Think of it as a power *source* node. |
| **Demand** | The electrical load being drawn off the grid (homes, factories). A *sink* node. |
| **Grid / Network** | The physical wires (lines) and connection points (buses) linking generators to demand. |
| **Transmission vs. Distribution** | Transmission = the high-voltage "highway" network moving bulk power long distances. Distribution = the lower-voltage "local roads" delivering it to end users. |
| **TSO / DNO** | Transmission/Distribution System Operator — the organization that runs and keeps that layer of network stable (in Ireland: **EirGrid** for the Republic, **SONI** for Northern Ireland). |
| **Synchronous vs. Non-synchronous generation** | Synchronous generators (coal, gas, hydro) spin a physical rotor locked to the grid's electrical frequency (50 Hz), which naturally provides stability ("inertia"). Non-synchronous sources (wind, solar, interconnectors, batteries) connect through electronics and don't provide this automatically — they're the reason the whole paper exists. |
| **Firm vs. Non-firm connection** | Firm = guaranteed, uninterruptible grid access. Non-firm = access granted, but the generator can be told to reduce output with no compensation if the grid needs it. Most new renewables get non-firm connections because grid upgrades can't keep pace with new wind/solar build-out. |
| **Power balance** | The physical law that generation must equal demand at every instant (plus losses) — you can't "store" AC electricity in the wires. This constraint underlies nearly every equation in the paper. |
| **Dispatch** | The act of telling a generator how much power to actually produce right now. "Dispatch down" = being told to produce less than planned. |

---

## Level 2 — How the Electricity Market Works

| Term | Definition |
|---|---|
| **SEM (Single Electricity Market)** | The shared wholesale electricity market covering the whole island of Ireland (ROI + NI). |
| **SEMO** | Single Electricity Market Operator — runs the SEM, settles imbalances, and publicly reports curtailment/constraint data. |
| **SEMOpx** | The exchange arm of SEMO that actually runs the day-ahead/intraday auctions. |
| **DAM (Day-Ahead Market)** | Where most electricity is traded ~1 day before delivery, clearing in 1-hour blocks via an algorithm called **EUPHEMIA**. |
| **Intraday Markets (IDA1/IDA2/IDA3, IDC)** | Follow-up trading windows closer to real time, letting participants correct their day-ahead position as forecasts improve. IDC (Intraday Continuous) is the last and most flexible one. |
| **Gate Closure (GC2)** | The final cutoff — one hour before delivery — after which a generator's trading position is locked in. |
| **FPN (Final Physical Notification)** | The output level a generator formally declares it will deliver, submitted at gate closure. Renewables mostly skip this and their weather forecast is used instead. |
| **Balancing Mechanism** | The real-time "clean-up" market where the TSO corrects the gap between what was traded and what's physically needed, including ordering curtailment. |
| **Unit Commitment (UC)** | An optimization that decides which generators should be switched *on/off* and roughly how much each should produce, at lowest cost, while meeting demand. |
| **SCUC / SCED / RTC / LTS** | Successive rounds of the TSO's scheduling process, from ~48 hours ahead (LTS) down to near real-time (RTC), each re-running Unit Commitment / Economic Dispatch with better information. |
| **Merit order** | Ranking generators from cheapest to most expensive to decide who runs first. Renewables are typically given "priority dispatch" (artificially cheap bids) so they run ahead of fossil plants. |

---

## Level 3 — Ireland-Specific Core Definitions (the paper's main subject)

| Term | Definition |
|---|---|
| **Curtailment** *(technical Irish definition)* | Dispatch-down **relative to a generator's FPN**, ordered to protect overall **system security** (not a local wire problem). Common causes: the SNSP limit, minimum inertia/frequency needs, or needing enough conventional plants running. Applied **pro-rata** — shared proportionally — across all non-synchronous generators island-wide. |
| **Constraint** *(technical Irish definition)* | Dispatch-down ordered by the control room because of a **local transmission bottleneck** — i.e., the wires in one area can't carry all the power being offered. Applied pro-rata **within specific constraint groups**, not island-wide. |
| **Surplus** | The gap between what renewables *could* generate (their weather-based technical potential) and what they actually got scheduled for in the market — i.e., wind/solar power left on the table before any curtailment order is even issued. |
| **Constraint Group** | A defined subset of generators (mapped geographically, see Fig. 1 in the paper) that share a local transmission bottleneck and therefore get curtailed together, proportionally. These groups can **overlap** (a generator can belong to more than one) and change over time. |
| **Pro-rata (curtailment policy)** | Ireland's rule: when a cut is needed, every affected generator loses the *same percentage* of its available output — as opposed to alternatives like **LIFO** (last connected = first cut, used in Great Britain) or **Dynamic Operating Envelopes (DOE)** (individualized, real-time-updated caps, used in South Australia). |
| **SNSP (System Non-Synchronous Penetration)** | The ratio of non-synchronous power (wind, solar, batteries discharging, imports) to total demand at a given instant. Ireland caps this at **75%** because too much non-synchronous power destabilizes grid frequency (not enough physical inertia). Exceeding the cap forces curtailment. |
| **MUON (Minimum Unit-run Requirement curtailment)** | Curtailment forced because a *minimum number/output* of conventional (synchronous) generators must stay online for stability reasons — even if renewables could otherwise supply the demand. |

---

## Level 4 — Modelling & Optimization Concepts

*(This is where the physics/math background actually helps — these are optimization and circuit-theory concepts dressed in power-systems language.)*

| Term | Definition |
|---|---|
| **MILP (Mixed Integer Linear Programming)** | An optimization problem with both continuous variables (e.g., MW output) and binary/integer variables (e.g., is a generator on or off?), solved to minimize a cost function subject to linear constraints. This is the mathematical backbone of the whole paper. |
| **Copper-plate model** | A simplifying assumption that treats the *entire* network as a single point with zero transmission constraints — as if all generators and demands sat on one infinitely conductive "copper plate." Used in the Market and Curtailment stages, where only *system-wide* limits (like SNSP) matter, not *local* wire capacity. |
| **DCOPF (DC Optimal Power Flow)** | A linearized approximation of real (AC) power flow: ignores reactive power, assumes constant voltage magnitude everywhere, and approximates power flow through a line as proportional to the *voltage angle difference* between its ends, divided by the line's reactance (this is directly analogous to Ohm's law, V=IR, with angle-difference playing the role of voltage and reactance playing the role of resistance). Needed once *local* transmission bottlenecks (Constraints) must be modeled explicitly. |
| **Voltage angle (δ) & Reactance (X)** | δ is the phase angle of AC voltage at a bus; X is the line's opposition to AC current flow (analogous to inductive impedance). Power flow on a line ≈ (angle difference) / (reactance) — this is the DCOPF's core equation. |
| **Big-M formulation** | A trick for encoding "if-then" logic (e.g., "only enforce this constraint IF demand exceeds X") into a *linear* problem, using a very large constant M multiplied by a binary variable to switch a constraint on or off. Necessary because MILP solvers can't directly handle conditional logic. |
| **VOLL (Value of Lost Load)** | The assumed economic cost (€/MWh) of demand not being served — used as a penalty in the objective function so the model avoids blackouts unless truly unavoidable. |
| **Redispatch** | Adjusting a generator's output *up* (offer) or *down* (bid) from its previously scheduled position, at a defined cost, to satisfy newly discovered constraints. |
| **N-1 contingency (mentioned as a limitation)** | An industry-standard security criterion requiring the grid to keep working even if any *single* piece of equipment (one line, one generator) suddenly fails. Not included in this model — a stated simplification. |

---

## Level 5 — Deep / Rarely-Seen Terms (paper-specific, low general reuse)

| Term | Definition |
|---|---|
| **ξ (xi) variables — pro-rata curtailment fraction** | The paper's core mathematical device: for overlapping constraint groups, each generator's actual output is capped at `min` of the pro-rata fractions (ξ) of *every* group it belongs to — implemented via binary variables **β_g,k** that pick out which group is currently the "binding" (most restrictive) one for that generator. This is the paper's genuinely novel contribution. |
| **ROCoF / Inertia constraints** | Rate of Change of Frequency and system inertia requirements — physical stability limits related to how fast grid frequency can safely drift after a disturbance. Mentioned but explicitly *excluded* from the model because they cause only ~0.6% of curtailment. |
| **RoCoF-style Named Constraint IDs (e.g., S_MWMAX_NI_GT, S_NBMIN_DUB_L2, S_MBMIN_CPS)** | Specific, named operational rules published weekly by EirGrid/SONI, each limiting either the total MW output (`MW`), MW-plus-reserve (`MWR`), or number of online units (`NB`) for a specific named group of generators — often tied to keeping a particular local area or specific power station (e.g. Coolkeeragh, Dublin) secure. These are essentially "case law" constraints baked directly into the optimization as extra inequalities. |
| **EWIC / Moyle** | The two HVDC (High Voltage Direct Current) subsea interconnector cables linking the Irish grid to Great Britain, modeled in this paper simply as generators with a *negative* lower bound (they can also import, i.e. act as demand). |
| **Interconnector import/export sets (G_I+, G_I−)** | Bookkeeping sets distinguishing interconnectors currently exporting power from Ireland vs. importing into it — needed because they enter the SNSP formula on opposite sides of the ratio. |
| **All-Island Ten Year Transmission Forecast Statement (TYTFS)** | The core real-world dataset (446 buses, 586 lines, 183 transformers, 288 generators) used to build the paper's realistic test network — a very specific, one-off data-provenance detail rather than a reusable concept. |

---

### How to use this
If you only remember **five terms**, make them: **Curtailment, Constraint, Constraint Group, SNSP, and Pro-rata** — the rest of the paper (the MILP, DCOPF, Big-M tricks) exists purely to *calculate* those five quantities accurately.
