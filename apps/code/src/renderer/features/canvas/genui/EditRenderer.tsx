import type { DragDropEvents } from "@dnd-kit/react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import {
  type BodyCtx,
  PLAIN_CTX,
  renderBody,
} from "@features/canvas/genui/bodies";
import { isEditableTextProp } from "@features/canvas/genui/editable";
import { useCanvasChatStore } from "@features/canvas/stores/canvasChatStore";
import type { Spec } from "@json-render/react";
import { DotsSixVerticalIcon } from "@phosphor-icons/react";
import { Tooltip } from "@radix-ui/themes";
import { type ReactNode, useRef } from "react";

// Edit-mode renderer: a thin recursive walk over the json-render Spec (the map
// key IS the element id, which createRenderer doesn't expose). Each element is
// rendered via the SAME presentational bodies as view mode (bodies.tsx), wrapped
// with hover/drag affordances and inline text editors.
//
// `interactive` is false while the agent streams — affordances collapse to a
// plain (view-identical) render so user edits can't race the incoming snapshots.
export function EditRenderer({
  spec,
  threadId,
  interactive,
}: {
  spec: Spec;
  threadId: string;
  interactive: boolean;
}) {
  const moveChild = useCanvasChatStore((s) => s.moveChild);

  const handleDragEnd: DragDropEvents["dragend"] = (event) => {
    const { source, target } = event.operation;
    if (!source || !target || source.id === target.id) return;
    const parentKey = source.data?.parentKey as string | undefined;
    // Only reorder within the same parent.
    if (!parentKey || target.data?.parentKey !== parentKey) return;
    moveChild(threadId, parentKey, String(source.id), String(target.id));
  };

  const tree = (
    <EditNode
      spec={spec}
      threadId={threadId}
      elementKey={spec.root}
      parentKey={null}
      index={0}
      interactive={interactive}
    />
  );

  if (!interactive) return tree;
  return <DragDropProvider onDragEnd={handleDragEnd}>{tree}</DragDropProvider>;
}

function EditNode({
  spec,
  threadId,
  elementKey,
  parentKey,
  index,
  interactive,
}: {
  spec: Spec;
  threadId: string;
  elementKey: string;
  parentKey: string | null;
  index: number;
  interactive: boolean;
}) {
  const element = spec.elements[elementKey];
  if (!element) return null;

  const childKeys = element.children ?? [];
  const children =
    childKeys.length > 0
      ? childKeys.map((childKey, i) => (
          <EditNode
            key={childKey}
            spec={spec}
            threadId={threadId}
            elementKey={childKey}
            parentKey={elementKey}
            index={i}
            interactive={interactive}
          />
        ))
      : undefined;

  const ctx: BodyCtx = interactive
    ? makeEditCtx(threadId, elementKey, element.type, element.props)
    : PLAIN_CTX;

  const body = renderBody(element.type, element.props, children, ctx);

  // Root is never draggable; children get a sortable + hover frame in edit mode.
  if (!interactive || parentKey === null) return body;
  return (
    <SortableElement
      elementKey={elementKey}
      parentKey={parentKey}
      index={index}
    >
      {body}
    </SortableElement>
  );
}

function makeEditCtx(
  threadId: string,
  elementKey: string,
  type: string,
  props: Record<string, unknown>,
): BodyCtx {
  return {
    text: (propPath, value) => (
      <InlineText
        key={`${elementKey}${propPath}`}
        threadId={threadId}
        elementKey={elementKey}
        propPath={propPath}
        value={value}
        multiline={type === "Text"}
        editable={isEditableTextProp(type, propPath, props)}
      />
    ),
    data: (node) => <DataHint>{node}</DataHint>,
  };
}

function SortableElement({
  elementKey,
  parentKey,
  index,
  children,
}: {
  elementKey: string;
  parentKey: string;
  index: number;
  children: ReactNode;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: elementKey,
    index,
    group: parentKey,
    data: { parentKey },
  });

  return (
    <div
      ref={ref}
      className="group/edit relative"
      style={{ opacity: isDragging ? 0.5 : 1 }}
    >
      <button
        type="button"
        ref={handleRef as React.RefCallback<HTMLButtonElement>}
        aria-label="Drag to reorder"
        className="-left-5 absolute top-1 z-10 flex h-5 w-5 cursor-grab items-center justify-center rounded text-gray-9 opacity-0 hover:bg-gray-4 hover:text-gray-11 active:cursor-grabbing group-hover/edit:opacity-100"
      >
        <DotsSixVerticalIcon size={14} />
      </button>
      <div className="rounded outline-1 outline-transparent outline-offset-2 transition-[outline-color] group-hover/edit:outline-accent-7">
        {children}
      </div>
    </div>
  );
}

function InlineText({
  threadId,
  elementKey,
  propPath,
  value,
  editable,
  multiline,
}: {
  threadId: string;
  elementKey: string;
  propPath: string;
  value: string;
  editable: boolean;
  multiline: boolean;
}) {
  const setElementProp = useCanvasChatStore((s) => s.setElementProp);
  const ref = useRef<HTMLSpanElement>(null);
  const original = useRef(value);

  if (!editable) return <>{value}</>;

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    let text = el.textContent ?? "";
    if (!multiline) text = text.replace(/\s*\n\s*/g, " ");
    if (text !== original.current) {
      setElementProp(threadId, elementKey, propPath, text);
      original.current = text;
    }
  };

  return (
    <>
      {/* An inline contentEditable span (not <input>) so text edits inherit the
          surrounding typography in place. */}
      {/* biome-ignore lint/a11y/useSemanticElements: an inline editable text node must stay a span to keep its typography */}
      <span
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        tabIndex={0}
        spellCheck={false}
        className="cursor-text rounded-sm px-0.5 outline-none hover:bg-gray-3 focus:bg-gray-3"
        style={multiline ? { whiteSpace: "pre-wrap" } : undefined}
        onFocus={() => {
          original.current = ref.current?.textContent ?? value;
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !multiline) {
            e.preventDefault();
            ref.current?.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            if (ref.current) ref.current.textContent = original.current;
            ref.current?.blur();
          }
        }}
      >
        {value}
      </span>
    </>
  );
}

function DataHint({ children }: { children: ReactNode }) {
  return (
    <Tooltip content="Data — from query">
      <span className="rounded-sm outline-dashed outline-1 outline-transparent hover:outline-gray-7">
        {children}
      </span>
    </Tooltip>
  );
}
