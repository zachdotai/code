type RadixOutsideEvent = CustomEvent<{
  originalEvent: { target: EventTarget | null };
}>;

/**
 * Suppress Dialog auto-close when the click originated inside a Quill
 * portal (combobox popup, etc.). Radix dispatches a CustomEvent whose
 * `target` is the dialog itself — the real click target lives on
 * `event.detail.originalEvent.target`.
 */
export function preventCloseOnQuillPortalInteraction(
  event: RadixOutsideEvent,
): void {
  const target = event.detail.originalEvent.target as HTMLElement | null;
  if (target?.closest("[data-quill-portal]")) {
    event.preventDefault();
  }
}
