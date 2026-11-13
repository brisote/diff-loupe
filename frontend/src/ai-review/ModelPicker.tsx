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
  const style = useBelow(anchor, 280);
  const rawModels = catalog?.models ?? [];
  const models = [...rawModels];
  if (selected && !models.some((m) => m.id === selected || m.name === selected)) {
    models.unshift({
      id: selected,
      name: selected,
      description: undefined,
    });
  }

  return (
    <Popup
      label="Review model"
      role="menu"
      className="dl-popup app-model-picker"
      anchor={anchor}
      style={{ ...style, width: 280 }}
      onClose={onClose}
    >
      <div className="dl-popup-section">Model</div>
      {models.length === 0 ? (
        <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-muted)" }}>
          No models available from ACP agent
        </div>
      ) : (
        models.map((model) => {
          const isSelected = selected
            ? selected === model.id || selected === model.name
            : model.id === catalog?.defaultModel;
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
        })
      )}
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
  const style = useBelow(anchor, 240);
  const rawEfforts = catalog?.efforts ?? [];
  const efforts = [...rawEfforts];
  if (selected && !efforts.some((e) => e.id === selected || e.name === selected)) {
    efforts.unshift({
      id: selected,
      name: selected.charAt(0).toUpperCase() + selected.slice(1),
      description: undefined,
    });
  }

  return (
    <Popup
      label="Reasoning effort"
      role="menu"
      className="dl-popup app-effort-picker"
      anchor={anchor}
      style={{ ...style, width: 240 }}
      onClose={onClose}
    >
      <div className="dl-popup-section">Reasoning effort</div>
      {efforts.length === 0 ? (
        <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-muted)" }}>
          No reasoning effort options available
        </div>
      ) : (
        efforts.map((effort) => {
          const isSelected = selected
            ? selected === effort.id || selected === effort.name
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
        })
      )}
    </Popup>
  );
}
