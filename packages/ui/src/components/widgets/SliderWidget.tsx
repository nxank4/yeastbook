import { useState, useCallback } from "react";

interface Props {
  widgetId: string;
  config: { min: number; max: number; step: number; label?: string };
  value: number;
  onUpdate: (widgetId: string, value: unknown) => void;
}

export function SliderWidget({ widgetId, config, value: initial, onUpdate }: Props) {
  const [value, setValue] = useState(initial);
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setValue(v);
    onUpdate(widgetId, v);
  }, [widgetId, onUpdate]);

  return (
    <div className="widget widget-slider">
      {config.label && <label className="widget-label">{config.label}</label>}
      <input type="range" min={config.min} max={config.max} step={config.step} value={value} onChange={handleChange} />
      <span className="widget-value">{value}</span>
    </div>
  );
}
