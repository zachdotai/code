import { Plus } from "@phosphor-icons/react";
import { Box } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";

export function AddCanvasButton() {
  const navigateToNewCanvas = useNavigationStore((s) => s.navigateToNewCanvas);

  return (
    <Box className="shrink-0 border-gray-6 border-t">
      <button
        type="button"
        className="flex w-full items-center gap-1 bg-transparent px-2 py-1.5 text-left text-[13px] text-gray-11 transition-colors hover:bg-gray-3"
        onClick={navigateToNewCanvas}
      >
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-gray-10">
          <Plus size={14} />
        </span>
        <span className="text-gray-11">Add canvas</span>
      </button>
    </Box>
  );
}
