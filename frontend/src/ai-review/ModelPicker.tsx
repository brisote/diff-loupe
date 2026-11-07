import type { RefObject } from "react";
import type { ModelsCatalog } from "../api/generated/ModelsCatalog";
import { Icon } from "../lib/icon";
import { Popup, useBelow } from "../lib/popup";

type ModelPickerProps = {
  anchor: RefObject<HTMLElement | null>;
  catalog: ModelsCatalog | null;
  selected: string | null;
  onSelect: (modelId: string) => void;
  onClose: () => void;
};

export function ModelPicker({ anchor, catalog, selected, onSelect, onClose }: ModelPickerProps) {
  const style = useBelow(anchor);
  const models = catalog?.models ?? [
    {
      id: "claude-3-7-sonnet",
      name: "Claude 3.7 Sonnet",
      description: "High intelligence with hybrid reasoning",
    },
    {
      id: "claude-3-5-sonnet",
      name: "Claude 3.5 Sonnet",
      description: "Balanced speed and deep code analysis (Default)",
    },
    {
      id: "claude-3-5-haiku",
      name: "Claude 3.5 Haiku",
      description: "Fast lightweight code review",
    },
  ];

  return (
    <Popup
      label="Review model"
      role="menu"
      className="dl-popup"
      anchor={anchor}
      style={{ ...style, width: 280, zIndex: 5 }}
      onClose={onClose}
    >
      <div className="dl-popup-section">Model</div>
      {models.map((model) => {
        const isSelected = selected ? selected === model.id : model.id === catalog?.defaultModel;
        const isDefault = catalog?.defaultModel === model.id;
        const desc = model.description
          ? isDefault && !model.description.includes("Default")
            ? `${model.description} (Default)`
            : model.description
          : isDefault
            ? "Default"
            : undefined;

        return (
          <button
            key={model.id}
            type="button"
            className={`dl-row ${isSelected ? "is-selected" : ""}`}
            style={{
              padding: "6px 10px",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              textAlign: "left",
              width: "100%",
              border: "none",
              background: isSelected ? "var(--row-current-bg)" : "transparent",
              cursor: "pointer",
            }}
            onClick={() => {
              onSelect(model.id);
              onClose();
            }}
          >
            {isSelected ? (
              <span
                style={{ width: 16, flex: "none", display: "inline-flex", alignItems: "center" }}
              >
                <Icon name="actions-check" />
              </span>
            ) : (
              <span style={{ width: 16, flex: "none" }} />
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: isSelected ? 600 : 500, color: "var(--text-color)" }}>
                {model.name}
              </span>
              {desc && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{desc}</span>}
            </div>
          </button>
        );
      })}
    </Popup>
  );
}

type EffortPickerProps = {
  anchor: RefObject<HTMLElement | null>;
  catalog: ModelsCatalog | null;
  selected: string | null;
  onSelect: (effortId: string) => void;
  onClose: () => void;
};

export function EffortPicker({ anchor, catalog, selected, onSelect, onClose }: EffortPickerProps) {
  const style = useBelow(anchor);
  const efforts = catalog?.efforts ?? [
    { id: "low", name: "Low", description: "Fastest response with minimal thinking" },
    { id: "medium", name: "Medium", description: "Balanced reasoning effort (Default)" },
    { id: "high", name: "High", description: "Comprehensive reasoning effort" },
  ];

  return (
    <Popup
      label="Reasoning effort"
      role="menu"
      className="dl-popup"
      anchor={anchor}
      style={{ ...style, width: 240, zIndex: 5 }}
      onClose={onClose}
    >
      <div className="dl-popup-section">Reasoning effort</div>
      {efforts.map((effort) => {
        const isSelected = selected
          ? selected === effort.id
          : effort.id === (catalog?.defaultEffort ?? "medium");
        const isDefault = (catalog?.defaultEffort ?? "medium") === effort.id;
        const desc = effort.description
          ? isDefault && !effort.description.includes("Default")
            ? `${effort.description} (Default)`
            : effort.description
          : isDefault
            ? "Default"
            : undefined;

        return (
          <button
            key={effort.id}
            type="button"
            className={`dl-row ${isSelected ? "is-selected" : ""}`}
            style={{
              padding: "6px 10px",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              textAlign: "left",
              width: "100%",
              border: "none",
              background: isSelected ? "var(--row-current-bg)" : "transparent",
              cursor: "pointer",
            }}
            onClick={() => {
              onSelect(effort.id);
              onClose();
            }}
          >
            {isSelected ? (
              <span
                style={{ width: 16, flex: "none", display: "inline-flex", alignItems: "center" }}
              >
                <Icon name="actions-check" />
              </span>
            ) : (
              <span style={{ width: 16, flex: "none" }} />
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: isSelected ? 600 : 500, color: "var(--text-color)" }}>
                {effort.name}
              </span>
              {desc && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{desc}</span>}
            </div>
          </button>
        );
      })}
    </Popup>
  );
}
