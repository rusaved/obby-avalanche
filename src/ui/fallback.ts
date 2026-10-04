import type { ThemeJson } from '../content/types.ts';

/**
 * No WebGL2 (docs/02-tech.md 9.4): a calm Canvas2D screen in the style of the game — title, code-drawn hero,
 * one line about updating the browser. No technical words, no alert, no console.error.
 */
export function drawNoGraphics(canvas: HTMLCanvasElement, title: string, message: string, theme: ThemeJson): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const w = (canvas.width = Math.max(320, canvas.clientWidth || window.innerWidth));
  const h = (canvas.height = Math.max(180, canvas.clientHeight || window.innerHeight));
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, theme.sky.top);
  sky.addColorStop(1, theme.sky.bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // slope
  ctx.fillStyle = theme.materials.track?.color ?? '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h * 0.7);
  ctx.lineTo(w, h * 0.45);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  // blocky hero
  const u = Math.min(w, h) / 14;
  const cx = w * 0.5;
  const base = h * 0.62;
  const skin = theme.materials.gateSign?.color ?? '#ff7a00';
  ctx.fillStyle = '#3C3F46';
  ctx.fillRect(cx - u * 0.9, base - u * 1.6, u * 0.8, u * 1.6);
  ctx.fillRect(cx + u * 0.1, base - u * 1.6, u * 0.8, u * 1.6);
  ctx.fillStyle = skin;
  ctx.fillRect(cx - u, base - u * 3.4, u * 2, u * 1.9);
  ctx.fillRect(cx - u * 1.6, base - u * 3.3, u * 0.55, u * 1.7);
  ctx.fillRect(cx + u * 1.05, base - u * 3.3, u * 0.55, u * 1.7);
  ctx.fillStyle = '#F6D3B3';
  ctx.fillRect(cx - u * 0.8, base - u * 5.1, u * 1.6, u * 1.6);
  ctx.fillStyle = '#E53935';
  ctx.fillRect(cx - u * 0.85, base - u * 5.5, u * 1.7, u * 0.5);
  ctx.fillStyle = '#222';
  ctx.fillRect(cx - u * 0.45, base - u * 4.6, u * 0.2, u * 0.25);
  ctx.fillRect(cx + u * 0.25, base - u * 4.6, u * 0.2, u * 0.25);
  ctx.beginPath();
  ctx.arc(cx, base - u * 4.0, u * 0.3, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.lineWidth = Math.max(1, u * 0.08);
  ctx.strokeStyle = '#222';
  ctx.stroke();
  // text
  ctx.fillStyle = '#1b2a3a';
  ctx.textAlign = 'center';
  ctx.font = `800 ${Math.round(u * 1.1)}px Rubik, system-ui, sans-serif`;
  ctx.fillText(title, cx, h * 0.17, w * 0.9);
  ctx.font = `500 ${Math.round(u * 0.7)}px Rubik, system-ui, sans-serif`;
  ctx.fillText(message, cx, h * 0.85, w * 0.9);
  return true;
}
