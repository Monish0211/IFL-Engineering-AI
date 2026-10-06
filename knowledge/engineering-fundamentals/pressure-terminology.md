---
title: Pressure Terminology (Operating, Design, MAWP, Test Pressure)
---

# Pressure Terminology

## Operating pressure

The pressure at which equipment or piping normally runs during steady
operation. Datasheets often list **normal**, **minimum** and **maximum
operating pressure** separately, because upsets and start-up/shutdown can
push the system away from its normal point.

## Design pressure

The pressure used to design a component — to size wall thickness, select
flange ratings, and set relief protection. It is set **above** the maximum
expected operating pressure, with a margin defined in the project design
basis or company practice. The margin rule is project-specific; there is
no single universal value, so always take it from the governing project
documents.

Design pressure is always stated together with a **coincident design
temperature**, because material strength falls as temperature rises.

## MAWP (Maximum Allowable Working Pressure)

For a pressure vessel, the MAWP is the maximum pressure permitted at the
top of the vessel, in its operating position, at the designated
temperature — calculated from the as-built thicknesses of its parts. MAWP
is often equal to or slightly higher than the design pressure. Relief
valve set pressure is normally referenced to the design pressure or MAWP
according to the applicable code.

## Test pressure

The pressure applied during a pressure test (hydrostatic or pneumatic) to
prove strength and tightness before service. The test pressure is derived
from the design pressure using a factor given by the applicable design code,
often adjusted for the ratio of material strength at test and design
temperature. Hydrostatic test factors in common codes are typically in the
range of about 1.3 to 1.5 times design pressure, but the exact factor and
conditions must be taken from the governing code and project specification.

## Gauge vs absolute pressure

- **Gauge pressure** (barg, psig, kPa(g)) is measured relative to local
  atmospheric pressure.
- **Absolute pressure** (bara, psia, kPa(a)) is measured relative to a
  perfect vacuum.
- Absolute ≈ gauge + 1.013 bar at sea level.

Always check which basis a document uses — mixing barg and bara is a
common source of error, especially for NPSH and vacuum services.

## Practical checks

- Design pressure ≥ maximum operating pressure (plus the project margin).
- Design temperature covers the maximum (and minimum) credible metal temperature.
- Flange class and piping class ratings must cover the design pressure at design temperature.
- Test pressures come from the code, not from rule of thumb.
