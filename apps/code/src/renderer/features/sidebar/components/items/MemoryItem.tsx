import { Brain } from "@phosphor-icons/react";
import { SidebarItem } from "../SidebarItem";

interface MemoryItemProps {
  isActive: boolean;
  onClick: () => void;
}

export function MemoryItem({ isActive, onClick }: MemoryItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<Brain size={16} weight={isActive ? "fill" : "regular"} />}
      label="Memory"
      isActive={isActive}
      onClick={onClick}
    />
  );
}
