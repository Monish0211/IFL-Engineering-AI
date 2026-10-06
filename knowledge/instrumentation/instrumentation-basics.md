---
title: Instrumentation Basics (Tagging, Signals, Datasheets)
---

# Instrumentation Basics

## Instrument tag letters

Instrument tags follow the functional identification convention widely
based on ISA-5.1 practice. The **first letter** is the measured or
initiating variable; **succeeding letters** give the function.

| First letter | Variable |
|---|---|
| F | Flow |
| P | Pressure |
| T | Temperature |
| L | Level |
| A | Analysis |

| Succeeding letter | Function |
|---|---|
| T | Transmitter |
| I | Indicator |
| C | Controller |
| V | Valve |
| E | Primary element |
| S | Switch |
| A | Alarm (often with H/L for high/low) |

Examples: **PT** pressure transmitter, **FIC** flow indicating controller,
**LV** level control valve, **TE** temperature element, **PSHH**
pressure switch high-high. A loop number follows, e.g. `FT-1001`,
`FIC-1001`, `FV-1001` form one flow control loop. Companies may add their
own conventions, so always check the project's instrument numbering procedure.

## Signals

- **4–20 mA** analogue signal: 4 mA = 0 % of range, 20 mA = 100 %. The
  "live zero" at 4 mA lets a broken wire (0 mA) be detected.
- **HART** superimposes digital data on the 4–20 mA loop (diagnostics, configuration).
- Fieldbus and other digital protocols are also used.

## Control vs safety systems

- The **BPCS** (basic process control system, often a DCS) runs normal control.
- The **SIS** (safety instrumented system) independently brings the process
  to a safe state when limits are exceeded. Safety functions are assigned a
  required **SIL** from a risk assessment.

## Key instrumentation documents

- **Instrument index** — list of all instruments with tag, service, type, P&ID, and status.
- **Instrument datasheet** — process conditions, range, materials, connections, certification.
- **Loop diagram** — wiring from field instrument to control system.
- **Cause & effect chart** — which trips/actions each initiator causes.
- **Hook-up drawing** — installation detail for the instrument.
