import * as THREE from 'three';
import { PMIViewsWidget } from '../UI/pmi/PMIViewsWidget.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export function test_pmi_monochrome_label_svg_uses_backdrop_color() {
  const widget = Object.create(PMIViewsWidget.prototype);
  widget.viewer = null;

  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const svg = widget._composeLabelSVG(
    'data:image/png;base64,',
    [{ world: new THREE.Vector3(0, 0, 0), text: 'R1.500', anchor: 'center middle' }],
    400,
    300,
    400,
    {
      viewer: { camera },
      renderMode: 'monochrome',
      labelBackdropColor: '#ff0000',
    },
  );

  assert(svg.includes('fill="#ff0000"'), 'Expected monochrome PMI label mask to use the view backdrop color.');
  assert(svg.includes('stroke="none"'), 'Expected monochrome PMI label mask to avoid drawing a border.');
}

export function test_pmi_enter_edit_mode_reuses_shared_flow() {
  const widget = Object.create(PMIViewsWidget.prototype);
  const calls = [];
  const view = { viewName: 'View 1' };
  const originalSetTimeout = globalThis.setTimeout;

  widget._enterEditMode = (viewArg, indexArg) => {
    calls.push({ view: viewArg, index: indexArg });
  };

  try {
    globalThis.setTimeout = (fn, _delay) => {
      fn();
      return 0;
    };
    widget.enterEditMode(view, 3);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert(calls.length === 2, 'Expected shared PMI edit flow to invoke the edit handoff twice.');
  assert(calls[0]?.view === view && calls[1]?.view === view, 'Expected shared PMI edit flow to forward the same view.');
  assert(calls[0]?.index === 3 && calls[1]?.index === 3, 'Expected shared PMI edit flow to forward the same view index.');
}
