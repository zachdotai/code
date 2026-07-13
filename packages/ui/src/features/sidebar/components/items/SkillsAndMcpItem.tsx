import { Plugs } from "@phosphor-icons/react";
import { SidebarItem } from "../SidebarItem";

interface SkillsAndMcpItemProps {
  isActive: boolean;
  onClick: () => void;
}

export function SkillsAndMcpItem({ isActive, onClick }: SkillsAndMcpItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<Plugs size={16} weight={isActive ? "fill" : "regular"} />}
      label="Skills and MCP"
      isActive={isActive}
      onClick={onClick}
    />
  );
}
