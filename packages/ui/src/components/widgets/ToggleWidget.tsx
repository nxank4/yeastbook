import { useState, useCallback } from "react";

interface Props {
  widgetId: string;
  config: { label?: string };
  value: boolean;
  onUpdate: (widgetId: string, value: unknown) => void;
}

export function ToggleWidget({ widgetId, config, value: initial, onUpdate }: Props) {
  const [value, setValue] = useState(initial);
  const handleToggle = useCallback(() => {
    const next = !value;
    setValue(next);
    onUpdate(widgetId, next);
  }, [widgetId, value, onUpdate]);

  return (
    <div className="widget widget-toggle">
      {config.label && <label className="widget-label">{config.label}</label>}
      <button className={`toggle ${value ? "on" : ""}`} onClick={handleToggle}>
        <span className="toggle-knob" />
      </button>
    </div>
  );
}
