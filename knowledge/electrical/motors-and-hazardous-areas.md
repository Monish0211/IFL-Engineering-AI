---
title: Electric Motors and Hazardous Area Classification
---

# Electric Motors and Hazardous Area Classification

## Induction motors

Most pumps, fans and compressors in process plants are driven by
three-phase **squirrel-cage induction motors**. Key data on a motor
datasheet:

- rated power (kW), voltage, frequency, and number of poles (which sets
  the synchronous speed: 3000 rpm for 2-pole at 50 Hz, 1500 rpm for 4-pole);
- full-load current, efficiency class, power factor;
- starting method (direct-on-line, soft starter, VFD);
- enclosure / **IP rating** and cooling method;
- hazardous area certification, where applicable.

Actual running speed is slightly below synchronous speed because of slip.

## IP rating

The IP (Ingress Protection) code gives protection against solids (first
digit) and water (second digit). For example, IP55 = dust-protected and
protected against water jets. Outdoor process equipment commonly requires
IP55 or better; the project specification sets the requirement.

## Hazardous area classification

Where flammable gas, vapour or dust may be present, the plant is divided
into zones according to how likely and how long an explosive atmosphere is
present.

IEC / zone system (gas):

| Zone | Explosive atmosphere present |
|---|---|
| Zone 0 | Continuously or for long periods |
| Zone 1 | Likely in normal operation |
| Zone 2 | Not likely in normal operation; if it occurs, only briefly |

North American practice may instead use the Class/Division system
(e.g. Class I, Division 1 or 2). Equipment in hazardous areas must carry
certification suitable for the zone, **gas group** and **temperature
class** (T-class) — for example Ex d (flameproof) or Ex e (increased safety)
motors.

## Good practice

- Take zone, gas group and temperature class from the project's hazardous area classification drawings.
- Confirm certification markings on vendor documents match the requirement.
- Motor rating must cover the driven machine's maximum power with the margin in the project specification.
