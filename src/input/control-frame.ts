/**
 * Two angles (docs/02-tech.md 6.3): `viewYaw` is where the camera looks (manual turns, auto-turn, scripted shots);
 * `controlYaw` is the frame of movement and only the player changes it. Manual camera rotation turns both;
 * when movement starts, controlYaw snaps to viewYaw unless a scripted shot runs.
 */
export interface ControlFrame {
  viewYaw: number;
  controlYaw: number;
  pitch: number;
  distance: number;
  /** A scripted camera shot (avalanche frame, studio) is running: movement keeps its own frame. */
  scripted: boolean;
}

export function createControlFrame(pitch: number, distance: number): ControlFrame {
  return { viewYaw: 0, controlYaw: 0, pitch, distance, scripted: false };
}

export function applyManualTurn(frame: ControlFrame, yawDelta: number, pitchDelta: number, pitchMin: number, pitchMax: number): void {
  if (yawDelta === 0 && pitchDelta === 0) return;
  frame.viewYaw = wrapAngle(frame.viewYaw + yawDelta);
  frame.controlYaw = wrapAngle(frame.controlYaw + yawDelta);
  frame.pitch = Math.min(pitchMax, Math.max(pitchMin, frame.pitch + pitchDelta));
}

export function onMoveStarted(frame: ControlFrame): void {
  if (!frame.scripted) frame.controlYaw = frame.viewYaw;
}

/** Control-frame direction (x right, y forward) → world XZ with yaw = 0 facing +Z. */
export function toWorld(moveX: number, moveY: number, yaw: number): { x: number; z: number } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return { x: moveX * c + moveY * s, z: -moveX * s + moveY * c };
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Shortest signed difference b − a. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}
