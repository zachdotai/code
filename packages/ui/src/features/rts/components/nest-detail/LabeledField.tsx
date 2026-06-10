import { Text } from "@radix-ui/themes";
import type { ReactNode } from "react";

interface LabeledFieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
  minWidth?: number;
}

export function LabeledField({
  label,
  htmlFor,
  children,
  minWidth,
}: LabeledFieldProps) {
  return (
    <div className="flex flex-1 flex-col" style={{ minWidth }}>
      <Text
        as="label"
        htmlFor={htmlFor}
        size="2"
        mb="1"
        weight="medium"
        className="block"
      >
        {label}
      </Text>
      {children}
    </div>
  );
}
