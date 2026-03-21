let widgetCounter = 0;

export interface Widget<T> {
  value: T;
  onChange(callback: (value: T) => void): void;
  destroy(): void;
  __widgetId: string;
  __type: "widget";
  __widgetType: string;
  __config: Record<string, unknown>;
  _callbacks: ((value: T) => void)[];
}

function createWidget<T>(type: string, value: T, config: Record<string, unknown>): Widget<T> {
  const id = `widget_${++widgetCounter}_${Date.now()}`;
  const callbacks: ((value: T) => void)[] = [];
  return {
    value, __widgetId: id, __type: "widget", __widgetType: type, __config: config, _callbacks: callbacks,
    onChange(cb) { callbacks.push(cb); },
    destroy() { callbacks.length = 0; },
  };
}

export function createSlider(config: { min: number; max: number; value?: number; step?: number; label?: string }): Widget<number> {
  return createWidget("slider", config.value ?? config.min, { min: config.min, max: config.max, step: config.step ?? 1, label: config.label });
}

export function createInput(config: { value?: string; placeholder?: string; label?: string }): Widget<string> {
  return createWidget("input", config.value ?? "", { placeholder: config.placeholder, label: config.label });
}

export function createToggle(config: { value?: boolean; label?: string }): Widget<boolean> {
  return createWidget("toggle", config.value ?? false, { label: config.label });
}

export function createSelect(config: { options: string[]; value?: string; label?: string }): Widget<string> {
  return createWidget("select", config.value ?? config.options[0] ?? "", { options: config.options, label: config.label });
}
