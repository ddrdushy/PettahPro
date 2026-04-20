import { useId, type InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

export function Field({ label, hint, id, className, ...rest }: Props) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div>
      <label htmlFor={inputId} className="block text-small font-medium text-charcoal">
        {label}
      </label>
      <input
        id={inputId}
        {...rest}
        className={`mt-1.5 block w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal ${className ?? ""}`}
      />
      {hint && <p className="mt-1.5 text-caption text-text-tertiary">{hint}</p>}
    </div>
  );
}
