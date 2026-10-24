import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";

type Option<T extends string> = { value: T; label: string };

type SelectProps<T extends string> = {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
};

export function Select<T extends string>({ label, value, options, onChange }: SelectProps<T>) {
  return (
    <label className="dl-field app-select">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="general-chevronDown" />
    </label>
  );
}

type CheckboxProps = {
  label: string;
  checked: boolean;
  mixed?: boolean;
  hideLabel?: boolean;
  onChange: (checked: boolean) => void;
};

export function Checkbox({ label, checked, mixed, hideLabel, onChange }: CheckboxProps) {
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const state = mixed ? "is-mixed" : checked ? "is-checked" : "";
  useEffect(() => {
    if (input.current) input.current.indeterminate = Boolean(mixed);
  }, [mixed]);
  return (
    <label className={`dl-check ${state} ${focused ? "is-focused" : ""}`}>
      <input
        ref={input}
        className="app-hidden-input"
        type="checkbox"
        aria-label={hideLabel ? label : undefined}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <span className="dl-check-box" aria-hidden="true" />
      {!hideLabel && label}
    </label>
  );
}
