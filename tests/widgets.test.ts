import { test, expect, describe } from "bun:test";
import { createSlider, createInput, createToggle, createSelect } from "../packages/core/src/widgets.ts";

describe("widgets", () => {
  test("createSlider returns correct shape", () => {
    const w = createSlider({ min: 0, max: 100, value: 50, label: "Volume" });
    expect(w.__type).toBe("widget");
    expect(w.__widgetType).toBe("slider");
    expect(w.value).toBe(50);
    expect(w.__config.min).toBe(0);
    expect(w.__config.max).toBe(100);
  });

  test("createInput returns correct shape", () => {
    const w = createInput({ value: "hello", placeholder: "Type..." });
    expect(w.__type).toBe("widget");
    expect(w.__widgetType).toBe("input");
    expect(w.value).toBe("hello");
  });

  test("createToggle returns correct shape", () => {
    const w = createToggle({ value: true, label: "Enable" });
    expect(w.__type).toBe("widget");
    expect(w.__widgetType).toBe("toggle");
    expect(w.value).toBe(true);
  });

  test("createSelect returns correct shape", () => {
    const w = createSelect({ options: ["a", "b"], value: "b" });
    expect(w.__type).toBe("widget");
    expect(w.__widgetType).toBe("select");
    expect(w.value).toBe("b");
  });

  test("onChange callback fires", () => {
    const w = createSlider({ min: 0, max: 100 });
    let received: number | undefined;
    w.onChange((v) => { received = v; });
    w._callbacks[0]!(75);
    expect(received).toBe(75);
  });

  test("createSlider defaults value to min when value not provided", () => {
    const w = createSlider({ min: 5, max: 10 });
    expect(w.value).toBe(5);
  });

  test("createSelect defaults value to first option when value not provided", () => {
    const w = createSelect({ options: ["a", "b", "c"] });
    expect(w.value).toBe("a");
  });

  test("destroy clears all onChange callbacks", () => {
    const w = createSlider({ min: 0, max: 100 });
    w.onChange(() => {});
    w.onChange(() => {});
    expect(w._callbacks.length).toBe(2);
    w.destroy();
    expect(w._callbacks.length).toBe(0);
  });
});
