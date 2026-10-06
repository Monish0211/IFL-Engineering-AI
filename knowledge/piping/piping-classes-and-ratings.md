---
title: Piping Classes, Pipe Schedules and Flange Ratings
---

# Piping Classes, Pipe Schedules and Flange Ratings

## Piping class (pipe spec)

A **piping class** is a project document that defines, for a given
service and pressure/temperature envelope, exactly which components may be
used: pipe material and wall thickness per size, fittings, flanges,
gaskets, bolting, valves, branch connections and corrosion allowance.
Each line on a P&ID or line list carries a class code, so designers and
procurement use the same approved components.

Piping classes are project-specific. The class naming convention (for
example, a letter for pressure rating plus a number for material) differs
between companies and projects.

## Nominal pipe size and schedule

- **NPS / DN** — the nominal size designation. For NPS 14 and larger the
  outside diameter equals the NPS in inches; smaller sizes have a fixed OD
  that differs from the nominal value.
- **Schedule** (e.g. SCH 40, SCH 80, SCH 160, XS, XXS) designates wall
  thickness. For a given NPS, a higher schedule means a thicker wall and
  smaller bore; the OD stays the same.
- Required wall thickness is calculated per the governing piping code from
  design pressure, temperature, material allowable stress, corrosion
  allowance and mill tolerance — then rounded up to an available schedule.

## Flange pressure classes

Flanges are specified by pressure class, such as Class 150, 300, 600,
900, 1500 and 2500. The class is **not** a pressure in psi or bar: the
permitted pressure for each class depends on the flange **material group
and temperature**, from the pressure–temperature rating tables in the
applicable flange standard. The allowable pressure decreases as temperature
rises.

## Flange facings

Common facings include raised face (RF), flat face (FF) and ring-type
joint (RTJ). The facing, gasket type and bolting must be compatible.

## Line designation

A typical line number combines size, fluid/service code, sequence number,
piping class and insulation code — for example `6"-CW-1001-A1-N`. The exact
format is defined by the project's numbering procedure.

## Good practice

- Always check that the selected class covers the line's design pressure at design temperature.
- Watch for **specification breaks** where a line changes class (e.g. at a pressure-reducing valve).
- Confirm corrosion allowance and material with the process/materials engineer.
