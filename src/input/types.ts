/** Per-frame input snapshot (docs/02-tech.md 6.2–6.3). Directions are in the control frame: x right, y forward. */
export interface InputSnapshot {
  moveX: number;
  moveY: number;
  /** Jump edge in this frame. */
  jumpPressed: boolean;
  jumpHeld: boolean;
  /** Manual camera rotation this frame, radians (yaw positive = turn left). */
  camYawDelta: number;
  camPitchDelta: number;
  /** Zoom change this frame, units. */
  zoomDelta: number;
  pausePressed: boolean;
  /** The camera was turned by hand in this tick: a drag on the camera zone (finger or mouse) past the tap distance.
   * A finger or a button resting on the zone is not a turn (PR-13). */
  manualCamera: boolean;
  /** Movement began this frame (stick touched, first move key): controlYaw snaps to viewYaw. */
  moveStarted: boolean;
  /** Last input came from touch (HUD shows the stick and the jump button). */
  touchActive: boolean;
}

export interface StickState {
  active: boolean;
  originX: number;
  originY: number;
  x: number;
  y: number;
  /** Stick vector after dead zone, length ≤ 1. */
  dx: number;
  dy: number;
}

export interface InputOptions {
  /** Dynamic stick radius as a fraction of the short screen side (0.12). */
  stickRadiusFrac: number;
  /** Dead zone as a fraction of the radius (0.10). */
  deadZoneFrac: number;
  mouseDegPerPx: number;
  touchDegPerPx: number;
  sensitivity: number;
  /** Autorun: tap shorter than this (ms) and smaller than tapMovePx is a jump. */
  tapMaxMs: number;
  tapMovePx: number;
  zoomStep: number;
}
