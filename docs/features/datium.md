# Datium

Status: Implemented

![Datum feature dialog](Datium_dialog.png)

Datium creates a reference triad of orthogonal `XY`, `XZ`, and `YZ` planes for sketching and other feature inputs.

## Inputs
- `transform` - position, rotation, and scale applied to the datum group.

## Behaviour
- Emits a `THREE.Group` named after the feature ID with three selectable plane meshes: `XY`, `XZ`, and `YZ`.
- The planes use the `PLANE` selection filter, so sketches and other downstream features can target them directly.
- The triad starts at the world origin, then applies the supplied transform.
