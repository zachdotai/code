import type { Editor } from "@tiptap/react";
import { useCallback, useMemo, useRef } from "react";
import type { TranscriptDelta } from "./webSpeech";

export interface EditorDictation {
  // Anchor dictation at the current cursor; call when listening starts.
  begin: () => void;
  // Apply a streaming transcript delta into the editor at the anchor.
  update: (delta: TranscriptDelta) => void;
  // Finalize: keep what was transcribed, stop tracking, and place the caret.
  end: () => void;
  // Streaming: replace the provisional (interim) region with the latest partial
  // transcript. Rewritten in place on each call as the guess is refined.
  updateInterim: (text: string) => void;
  // Streaming: commit the final transcript over the provisional region and stop
  // tracking (an empty string just clears any leftover interim), then place the
  // caret. Also works as a one-shot insert when no interim was streamed.
  finalize: (text: string) => void;
}

// Streams a dictation transcript into a Tiptap editor. Finalized words become
// permanent text; the still-changing interim tail is rewritten in place on each
// update so the box mirrors what's being said. Only the region this controller
// owns (from the anchor to the end of the current interim) is ever touched, so
// text the user typed before starting dictation is preserved.
export function useEditorDictation(editor: Editor | null): EditorDictation {
  // Document position just before the dictation-owned text.
  const anchorRef = useRef(0);
  // Length of the interim tail we may still replace on the next update.
  const interimLenRef = useRef(0);
  // Whether any transcript text has been inserted yet (gates the leading space).
  const insertedRef = useRef(false);
  // Whether a separating space is needed before the first dictated word.
  const leadingSpaceRef = useRef(false);

  const begin = useCallback(() => {
    if (!editor) return;
    editor.commands.focus("end", { scrollIntoView: true });
    const pos = Math.min(
      editor.state.selection.to,
      editor.state.doc.content.size,
    );
    anchorRef.current = pos;
    interimLenRef.current = 0;
    insertedRef.current = false;
    // Separate dictation from preceding text unless it already ends in
    // whitespace, so a dictated word doesn't fuse onto the previous one.
    const charBefore = editor.state.doc.textBetween(Math.max(0, pos - 1), pos);
    leadingSpaceRef.current = charBefore.length > 0 && !/\s/.test(charBefore);
  }, [editor]);

  const update = useCallback(
    (delta: TranscriptDelta) => {
      if (!editor) return;
      const incoming = delta.final + delta.interim;
      const prefix =
        leadingSpaceRef.current && !insertedRef.current && incoming ? " " : "";

      // Rewrite the interim tail with [prefix][newly-final][interim]. An empty
      // string collapses the range, which clears a retracted interim guess.
      const from = anchorRef.current;
      const docEnd = editor.state.doc.content.size;
      const to = Math.min(from + interimLenRef.current, docEnd);
      const tr = editor.state.tr;
      tr.insertText(prefix + delta.final + delta.interim, from, to);
      editor.view.dispatch(tr);

      // The prefix and newly-final text are permanent; advance past them and
      // keep only the interim as the replaceable tail.
      anchorRef.current = from + prefix.length + delta.final.length;
      interimLenRef.current = delta.interim.length;
      if (incoming) insertedRef.current = true;
    },
    [editor],
  );

  const end = useCallback(() => {
    if (!editor) return;
    // Any leftover interim (rare — the engine usually finalizes on stop) stays
    // put; we just stop tracking it and drop the caret after it.
    const caret = Math.min(
      anchorRef.current + interimLenRef.current,
      editor.state.doc.content.size,
    );
    interimLenRef.current = 0;
    insertedRef.current = false;
    editor.commands.focus(caret, { scrollIntoView: true });
  }, [editor]);

  const updateInterim = useCallback(
    (text: string) => {
      update({ final: "", interim: text });
    },
    [update],
  );

  const finalize = useCallback(
    (text: string) => {
      update({ final: text, interim: "" });
      end();
    },
    [update, end],
  );

  return useMemo(
    () => ({ begin, update, end, updateInterim, finalize }),
    [begin, update, end, updateInterim, finalize],
  );
}
