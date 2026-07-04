// Host renderers (e.g. the desktop quick-entry overlay) build custom chrome
// around the editor created by useTiptapEditor. They must render it through
// the same @tiptap/react instance that created it, so re-export the component
// here instead of having hosts import @tiptap/react themselves.
export { EditorContent as TiptapEditorContent } from "@tiptap/react";
