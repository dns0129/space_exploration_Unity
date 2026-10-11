import { emptyInput } from "./ship-dynamics";
import type { FlightInput } from "./ship-dynamics";
export class FlightControls {
  private keys = new Set<string>();
  private touch = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private pointer: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private steering = false;
  private walking = false;
  private canvas: HTMLCanvasElement;
  private cleanups: (() => void)[] = [];
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const on = (target: EventTarget, name: string, handler: EventListener) => {
      target.addEventListener(name, handler);
      this.cleanups.push(() => target.removeEventListener(name, handler));
    };
    on(window, "keydown", ((e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        document.querySelector("dialog[open]") ||
        (e.target instanceof Element &&
          e.target.closest("input,select,textarea"))
      )
        return;
      if (
        [
          "KeyW",
          "KeyS",
          "KeyA",
          "KeyD",
          "KeyR",
          "KeyF",
          "KeyQ",
          "KeyE",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Space",
          "ShiftLeft",
          "ShiftRight",
        ].includes(e.code)
      ) {
        e.preventDefault();
        this.keys.add(e.code);
      }
    }) as EventListener);
    on(window, "keyup", ((e: KeyboardEvent) => {
      this.keys.delete(e.code);
    }) as EventListener);
    on(window, "blur", (() => this.clear()) as EventListener);
    on(document, "visibilitychange", (() => this.clear()) as EventListener);
    on(canvas, "pointerdown", ((e: PointerEvent) => {
      if (e.button !== 0 || (e.pointerType === "mouse" && !this.walking) || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      this.pointer = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    }) as EventListener);
    on(canvas, "pointermove", ((e: PointerEvent) => {
      if (e.pointerType === "mouse" && !this.walking) return;
      if (this.pointer !== e.pointerId) return;
      this.mouseX = Math.max(-1, Math.min(1, (e.clientX - this.lastX) / 80));
      this.mouseY = Math.max(-1, Math.min(1, (e.clientY - this.lastY) / 80));
      this.steering = true;
    }) as EventListener);
    const stop = ((e: PointerEvent) => {
      if (this.pointer === e.pointerId) {
        this.pointer = null;
        this.centerSteering();
      }
    }) as EventListener;
    on(canvas, "pointerup", stop);
    on(canvas, "pointercancel", stop);
    on(canvas, "lostpointercapture", stop);
    on(canvas, "pointerleave", (() => { if (this.pointer === null) this.centerSteering(); }) as EventListener);
    document
      .querySelectorAll<HTMLButtonElement>("[data-flight-input]")
      .forEach((button) => {
        const action = button.dataset.flightInput!;
        on(button, "pointerdown", ((e: PointerEvent) => {
          if (document.querySelector("dialog[open]")) return;
          e.preventDefault();
          button.setPointerCapture(e.pointerId);
          this.touch.add(action);
          button.classList.add("held");
        }) as EventListener);
        const release = (() => {
          this.touch.delete(action);
          button.classList.remove("held");
        }) as EventListener;
        on(button, "pointerup", release);
        on(button, "pointercancel", release);
        on(button, "lostpointercapture", release);
      });
  }
  read(): FlightInput {
    if (document.querySelector("dialog[open]")) {
      this.clear();
      return emptyInput();
    }
    const has = (...keys: string[]) =>
      keys.some((k) => this.keys.has(k) || this.touch.has(k));
    const value = (positive: string, negative: string) =>
      Number(has(positive)) - Number(has(negative));
    const input = {
      ...emptyInput(),
      throttle: value("KeyW", "KeyS"),
      strafe: value("KeyD", "KeyA"),
      lift: this.walking ? 0 : value("KeyR", "KeyF"),
      yaw: value("ArrowLeft", "ArrowRight"),
      pitch: value("ArrowUp", "ArrowDown"),
      roll: this.walking ? 0 : value("KeyQ", "KeyE"),
      boost: has("ShiftLeft", "ShiftRight"),
      brake: has("Space"),
      mouseX: this.deadzone(this.mouseX),
      mouseY: this.deadzone(this.mouseY),
    };
    return input;
  }
  private deadzone(value: number) {
    return Math.sign(value) * Math.max(0, (Math.abs(value) - 0.08) / 0.92);
  }
  setWalking(active: boolean) {
    if (this.walking === active) return;
    this.clear();
    this.walking = active;
  }
  get aim() { return { x: this.mouseX, y: this.mouseY, active: this.steering }; }
  private centerSteering() {
    this.mouseX = 0;
    this.mouseY = 0;
    this.steering = false;
  }
  clear() {
    const pointer = this.pointer;
    this.pointer = null;
    if (pointer !== null && this.canvas.hasPointerCapture(pointer))
      this.canvas.releasePointerCapture(pointer);
    this.keys.clear();
    this.touch.clear();
    this.centerSteering();
    document
      .querySelectorAll("[data-flight-input]")
      .forEach((b) => b.classList.remove("held"));
  }
  dispose() {
    const pointer = this.pointer;
    this.cleanups.forEach((f) => f());
    if (pointer !== null && this.canvas.hasPointerCapture(pointer))
      this.canvas.releasePointerCapture(pointer);
    this.clear();
  }
}
