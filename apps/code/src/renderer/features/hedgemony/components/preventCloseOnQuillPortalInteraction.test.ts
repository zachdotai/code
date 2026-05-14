import { describe, expect, it, vi } from "vitest";
import { preventCloseOnQuillPortalInteraction } from "./preventCloseOnQuillPortalInteraction";

function buildEvent(target: EventTarget | null) {
  const preventDefault = vi.fn();
  const event = {
    detail: { originalEvent: { target } },
    target: document.body,
    preventDefault,
  };
  return { event, preventDefault };
}

describe("preventCloseOnQuillPortalInteraction", () => {
  it("prevents default when the click target is inside a Quill portal", () => {
    const portal = document.createElement("div");
    portal.setAttribute("data-quill-portal", "popover");
    const inner = document.createElement("button");
    portal.appendChild(inner);
    document.body.appendChild(portal);

    const { event, preventDefault } = buildEvent(inner);
    preventCloseOnQuillPortalInteraction(
      event as unknown as Parameters<
        typeof preventCloseOnQuillPortalInteraction
      >[0],
    );

    expect(preventDefault).toHaveBeenCalledTimes(1);

    document.body.removeChild(portal);
  });

  it("does not prevent default when the click target is outside any Quill portal", () => {
    const outside = document.createElement("div");
    document.body.appendChild(outside);

    const { event, preventDefault } = buildEvent(outside);
    preventCloseOnQuillPortalInteraction(
      event as unknown as Parameters<
        typeof preventCloseOnQuillPortalInteraction
      >[0],
    );

    expect(preventDefault).not.toHaveBeenCalled();

    document.body.removeChild(outside);
  });

  it("does not prevent default when the original target is null", () => {
    const { event, preventDefault } = buildEvent(null);
    preventCloseOnQuillPortalInteraction(
      event as unknown as Parameters<
        typeof preventCloseOnQuillPortalInteraction
      >[0],
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("reads the click target from event.detail.originalEvent.target, not event.target", () => {
    // Regression: Radix dispatches a CustomEvent whose `target` is the
    // dialog content (not the clicked element). The handler must look at
    // detail.originalEvent.target to find the real click target.
    const portal = document.createElement("div");
    portal.setAttribute("data-quill-portal", "popover");
    const inner = document.createElement("button");
    portal.appendChild(inner);
    document.body.appendChild(portal);

    const unrelatedDialog = document.createElement("div");
    document.body.appendChild(unrelatedDialog);

    const preventDefault = vi.fn();
    const event = {
      detail: { originalEvent: { target: inner } },
      target: unrelatedDialog,
      preventDefault,
    };
    preventCloseOnQuillPortalInteraction(
      event as unknown as Parameters<
        typeof preventCloseOnQuillPortalInteraction
      >[0],
    );

    expect(preventDefault).toHaveBeenCalledTimes(1);

    document.body.removeChild(portal);
    document.body.removeChild(unrelatedDialog);
  });
});
