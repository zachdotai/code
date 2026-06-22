import {
  type Extension,
  RangeSet,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import {
  type ApmLineMarker,
  buildApmLineMarkers,
} from "@posthog/core/code-editor/buildApmLineMarkers";
import type { SerializedApmEnrichment } from "@posthog/shared";
import { useApmPopoverStore } from "../stores/apmPopoverStore";

export const setApmEnrichmentEffect =
  StateEffect.define<SerializedApmEnrichment | null>();

interface ApmFieldState {
  /** File the stats were matched against; shown in the popover footer. */
  filePath: string | null;
  /** Deep link to the PostHog tracing explorer for the popover's link. */
  tracingUrl: string | null;
  /** One presence marker per instrumented line, keyed by line number. */
  markers: Map<number, ApmLineMarker>;
  /** Gutter marker set, cached so it isn't rebuilt on every view update. */
  rangeSet: RangeSet<GutterMarker>;
}

// Markers render at the span's raw `code.lineno` — the exact instrumentation
// site the OTel SDK reported (e.g. a Rust `#[instrument]` attribute or a Python
// decorator, which may sit just above the function). This is correct in every
// language with no per-language heuristics; the breakdown already yields one
// row per line, so there's never more than one marker per line.
const apmMarkerField = StateField.define<ApmFieldState>({
  create: () => ({
    filePath: null,
    tracingUrl: null,
    markers: new Map(),
    rangeSet: RangeSet.empty,
  }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setApmEnrichmentEffect)) {
        const enrichment = effect.value;
        const markers = new Map<number, ApmLineMarker>();
        for (const m of buildApmLineMarkers(enrichment)) markers.set(m.line, m);
        return {
          filePath: enrichment?.filePath ?? null,
          tracingUrl: enrichment?.tracingUrl ?? null,
          markers,
          rangeSet: markersToRangeSet(markers, tr.state.doc),
        };
      }
    }
    // Re-anchor cached markers when the doc shifts line offsets (read-only
    // today, but keeps positions correct if the view becomes editable).
    if (tr.docChanged && value.markers.size > 0) {
      return {
        ...value,
        rangeSet: markersToRangeSet(value.markers, tr.state.doc),
      };
    }
    return value;
  },
});

// One fixed colour: the gutter signals "PostHog has data on this line", not a
// severity. The numbers (and any errors) live in the popover.
class ApmPresenceMarker extends GutterMarker {
  constructor(private readonly marker: ApmLineMarker) {
    super();
  }
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-apm-marker";
    el.title = this.marker.summary;
    el.dataset.apmLine = String(this.marker.line);
    return el;
  }
}

const markerTheme = EditorView.baseTheme({
  ".cm-apm-gutter": { width: "6px", paddingLeft: "2px" },
  ".cm-apm-marker": {
    width: "4px",
    height: "100%",
    minHeight: "1em",
    borderRadius: "2px",
    cursor: "pointer",
    backgroundColor: "var(--purple-9, #8b5cf6)",
    opacity: "0.85",
  },
  ".cm-apm-marker:hover": { opacity: "1" },
});

function markersToRangeSet(
  markers: Map<number, ApmLineMarker>,
  doc: Text,
): RangeSet<GutterMarker> {
  const ranges = [...markers.values()]
    .filter((m) => m.line >= 1 && m.line <= doc.lines)
    .sort((a, b) => a.line - b.line)
    .map((m) => new ApmPresenceMarker(m).range(doc.line(m.line).from));
  return RangeSet.of(ranges);
}

function openApmPopover(view: EditorView, lineNo: number, event: MouseEvent) {
  const state = view.state.field(apmMarkerField);
  const marker = state.markers.get(lineNo);
  if (!marker) return;
  useApmPopoverStore.getState().show(
    {
      top: event.clientY,
      bottom: event.clientY,
      left: event.clientX,
      right: event.clientX,
    },
    marker,
    { filePath: state.filePath, tracingUrl: state.tracingUrl },
  );
}

const apmGutter = gutter({
  class: "cm-apm-gutter",
  markers: (view) => view.state.field(apmMarkerField).rangeSet,
  domEventHandlers: {
    click(view, line, event) {
      const lineNo = view.state.doc.lineAt(line.from).number;
      if (!view.state.field(apmMarkerField).markers.has(lineNo)) return false;
      openApmPopover(view, lineNo, event as MouseEvent);
      return true;
    },
  },
});

export function postHogApmEnrichmentExtension(): Extension {
  return [apmMarkerField, apmGutter, markerTheme];
}
