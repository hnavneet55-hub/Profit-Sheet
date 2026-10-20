"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  variant?: "primary" | "ghost";
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={variant === "primary" ? "btn" : "btn-ghost"} disabled={pending} name={name} value={value}>
      {pending ? pendingLabel : children}
    </button>
  );
}
