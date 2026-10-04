import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  NeutralToneMapping,
  SRGBColorSpace,
} from 'three';
import type { ThemeJson } from '../content/types.ts';

export interface RenderInfo {
  calls: number;
  triangles: number;
  textures: number;
  geometries: number;
  programs: number;
  frame: number;
}

export interface GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly glRenderer: string;
  resize(width: number, height: number, dpr: number): void;
  render(): void;
  info(): RenderInfo;
  compile(): Promise<void>;
  dispose(): void;
}

/** WebGL2 only (docs/02-tech.md 9.4): returns null when the context cannot be created. */
export function createWebGL2Context(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
    });
    return gl instanceof WebGL2RenderingContext ? gl : null;
  } catch {
    return null;
  }
}

/** Reads UNMASKED_RENDERER_WEBGL for the environment log (docs/05, M0 smoke). */
export function describeGl(gl: WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const unmasked = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : '';
  return unmasked || (gl.getParameter(gl.RENDERER) as string) || 'unknown';
}

export function createGameRenderer(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, theme: ThemeJson): GameRenderer {
  const renderer = new WebGLRenderer({ canvas, context: gl, antialias: false, alpha: false });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = false;
  renderer.setClearColor(new Color(theme.sky.bottom), 1);

  const scene = new Scene();
  scene.background = new Color(theme.sky.bottom);
  scene.fog = new Fog(new Color(theme.fog.color), theme.fog.near, theme.fog.far);

  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 400);
  camera.position.set(0, 6, -12);
  camera.lookAt(0, 1, 20);

  const hemi = new HemisphereLight(new Color(theme.sky.top), new Color(theme.materials.track?.color ?? '#ffffff'), 0.6);
  scene.add(hemi);
  const ambient = new AmbientLight(new Color(theme.light.ambient), theme.light.ambientIntensity * 0.5);
  scene.add(ambient);
  const sun = new DirectionalLight(new Color(theme.light.sun), theme.light.sunIntensity);
  sun.position.set(theme.light.sunDir[0] * 50, theme.light.sunDir[1] * 50, theme.light.sunDir[2] * 50);
  scene.add(sun);

  // M0 scene: a snowy plane; the mountain of worlds.json arrives at M1.
  const ground = new Mesh(
    new PlaneGeometry(200, 400, 1, 1),
    new MeshStandardMaterial({ color: new Color(theme.materials.track?.color ?? '#ffffff'), roughness: theme.materials.track?.roughness ?? 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 100);
  scene.add(ground);

  const glRenderer = describeGl(gl);

  return {
    renderer,
    scene,
    camera,
    glRenderer,
    resize(width, height, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    render() {
      renderer.render(scene, camera);
    },
    info() {
      const i = renderer.info;
      return {
        calls: i.render.calls,
        triangles: i.render.triangles,
        textures: i.memory.textures,
        geometries: i.memory.geometries,
        programs: i.programs?.length ?? 0,
        frame: i.render.frame,
      };
    },
    async compile() {
      await renderer.compileAsync(scene, camera);
    },
    dispose() {
      renderer.dispose();
    },
  };
}
