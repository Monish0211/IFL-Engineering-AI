---
title: Common First-Principles Engineering Calculations
---

# Common First-Principles Engineering Calculations

These are **first-principles** relationships for quick checks and
understanding. Design calculations for pressure-containing equipment must
follow the governing code and project procedures, and be checked by a
competent engineer.

## Flow velocity in a pipe

  v = Q / A,   A = π · d² / 4

- Q = volumetric flow (m³/s), d = internal diameter (m), v in m/s.
- Example: 250 m³/h (= 0.0694 m³/s) in a pipe with 0.154 m ID →
  A = 0.0186 m² → v ≈ 3.7 m/s.

Typical velocity limits for liquids and gases depend on service, noise,
erosion and pressure drop, and are defined in project design criteria.

## Pump hydraulic power and shaft power

  P_hydraulic = ρ · g · Q · H

  P_shaft = P_hydraulic / η

- ρ = density (kg/m³), g = 9.81 m/s², Q in m³/s, H = differential head (m), η = pump efficiency (0–1).
- Example: water, Q = 0.0694 m³/s, H = 60 m, η = 0.75 →
  P_hydraulic ≈ 998 × 9.81 × 0.0694 × 60 ≈ 40.8 kW;
  P_shaft ≈ 54 kW. The motor is then selected with the margin required by
  the project specification.

## Pressure from head

  ΔP = ρ · g · H

For water, 1 bar ≈ 10.2 m of head.

## Hoop stress in a thin-walled cylinder (Barlow)

  σ_hoop ≈ P · D / (2 · t)

- P = internal pressure, D = outside diameter, t = wall thickness.
- Useful for understanding how stress scales with pressure and diameter.
  **It is not a code wall-thickness calculation** — code formulas add
  allowable stresses, joint efficiencies, temperature and coefficient
  factors, corrosion allowance and manufacturing tolerance.

## Thermal expansion

  ΔL = α · L · ΔT

- α for carbon steel ≈ 12 × 10⁻⁶ /°C (approximate; varies with temperature).
- Example: 50 m of carbon steel pipe heated by 100 °C expands about 60 mm —
  why piping needs flexibility (loops, bends) and stress analysis.

## Checking results

- Keep units consistent (SI throughout) and convert at the end.
- Sanity-check against typical ranges.
- Record assumptions; flag anything that needs confirmation from project data.
