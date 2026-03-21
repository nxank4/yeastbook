import { useState, useCallback } from "react";

interface Props {
  widgetId: string;
  config: { options: string[]; label?: string };
  value: string;
  onUpdate: (widgetId: string, value: unknown) => void;
}

export function SelectWidget({ widgetId, config, value: initial, onUpdate }: Props) {
  const [value, setValue] = useState(initial);
  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setValue(e.target.value);
    onUpdate(widgetId, e.target.value);
  }, [widgetId, onUpdate]);

  return (
    <div className="widget widget-select">
      {config.label && <label className="widget-label">{config.label}</label>}
      <select value={value} onChange={handleChange} className="widget-select-input">
        {config.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}
