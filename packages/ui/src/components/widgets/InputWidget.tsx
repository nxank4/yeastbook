import { useState, useCallback } from "react";

interface Props {
  widgetId: string;
  config: { placeholder?: string; label?: string };
  value: string;
  onUpdate: (widgetId: string, value: unknown) => void;
}

export function InputWidget({ widgetId, config, value: initial, onUpdate }: Props) {
  const [value, setValue] = useState(initial);
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    onUpdate(widgetId, e.target.value);
  }, [widgetId, onUpdate]);

  return (
    <div className="widget widget-input">
      {config.label && <label className="widget-label">{config.label}</label>}
      <input type="text" value={value} placeholder={config.placeholder} onChange={handleChange} className="widget-text-input" />
    </div>
  );
}
