/** Adaptive resolution with a sharpness floor and steady recovery, targeting a 60 Hz frame budget. */
export class RenderBudget {
  ratio = 1;
  private ceiling = 1;
  private averageMs = 16.7;
  private windowSeconds = 0;
  private healthySeconds = 0;
  private slowFrames = 0;
  private sampledFrames = 0;
  private minimumRatio = 0.5;
  private holdSeconds = 0;
  configure(quality: boolean | "standard" | "high" | "ultra", deviceRatio: number, width: number, height: number, minimumRatio = 0.5) {
    this.minimumRatio = minimumRatio;
    const ultra = quality === "ultra", high = quality === true || quality === "high" || ultra;
    const pixelLimit = ultra ? 8_300_000 : high ? 2_100_000 : 1_200_000;
    this.ceiling = Math.min(high ? Math.min(deviceRatio, ultra ? 2 : 1.5) : 1,
      Math.sqrt(pixelLimit / Math.max(1, width * height)));
    this.ratio = this.ceiling;
    this.averageMs = 16.7;
    this.windowSeconds = -1.5;
    this.healthySeconds = 0;
    this.slowFrames = this.sampledFrames = 0;
  }
  /** A still image needs no frame budget: return to full sharpness. Returns true if the ratio changed. */
  rest() {
    if (this.ratio >= this.ceiling) return false;
    this.ratio = this.ceiling;
    this.windowSeconds = -1.5;
    this.healthySeconds = this.slowFrames = this.sampledFrames = 0;
    return true;
  }
  /** Ignore frames briefly, e.g. while a large texture uploads, so one stall doesn't blur the view. */
  hold(seconds: number) {
    this.holdSeconds = Math.max(this.holdSeconds, seconds);
  }
  sample(seconds: number) {
    if (seconds <= 0 || seconds > 0.25) return false;
    if (this.holdSeconds > 0) {
      this.holdSeconds -= seconds;
      return false;
    }
    this.averageMs += (seconds * 1000 - this.averageMs) * (1 - Math.exp(-seconds * 2));
    this.sampledFrames++;
    if (seconds > 0.024) this.slowFrames++;
    this.windowSeconds += seconds;
    if (this.windowSeconds < 1) return false;
    this.windowSeconds = 0;
    const missedFraction = this.slowFrames / this.sampledFrames;
    this.slowFrames = this.sampledFrames = 0;
    const previous = this.ratio;
    if (this.averageMs > 19 || missedFraction > 0.045) {
      this.ratio = Math.max(Math.min(this.minimumRatio, this.ceiling), this.ratio * 0.82);
      this.healthySeconds = 0;
    } else if (this.averageMs < 17.2 && missedFraction <= 0.02) {
      // Recover sharpness steadily once frames are healthy again.
      if (++this.healthySeconds >= 3) {
        this.ratio = Math.min(this.ceiling, this.ratio * 1.08);
        this.healthySeconds = 0;
      }
    } else this.healthySeconds = 0;
    return Math.abs(previous - this.ratio) > 0.001;
  }
}
