![Modeling Mode](../MODELING.png)

# Modeling Mode

Modeling Mode is the default solid-modeling workspace. It combines the history tree, 3D viewport, and the standard modeling toolbars for building and editing parts.

## Main Panels
- Main toolbar for save, view, import/export, and app-level actions
- History panel for creating and reordering features
- Expressions panel for shared variables and configurator widgets
- Inspector for per-face metrics such as area and owning feature

## Expressions Panel

- `expressions`: a shared JavaScript-style scratchpad for variables such as `width = 20;`
- `configurator`: a UI-driven set of widgets (`slider`, `number`, `select`, `string`) whose values are injected into expressions as `configurator.fieldName`

If configurator widgets exist, their generated form appears above the editor. Those values are stored in part history, survive save/load, and can be referenced from feature dialogs.

For the feature menu that backs this mode, see [Modeling Workbench](../workbenches/modeling.md).
