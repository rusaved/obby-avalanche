import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  NeutralToneMapping,
  SRGBColorSpace,
  PCFSoftShadowMap,
  Vector3,
} from 'three';
import type { ThemeJson } from '../content/types.ts';
import type { QualityParams } from './quality.ts';

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
  readonly sun: DirectionalLight;
  readonly glRenderer: string;
  resize(width: number, height: number, dpr: number): void;
  render(): void;
  info(): RenderInfo;
  compile(): Promise<void>;
  applyQuality(q: QualityParams): void;
  /** Shadow camera and sky follow the hero. */
  follow(target: Vector3): void;
  dispose(): void;
}

/** WebGL2 only (docs/02-tech.md 9.4): returns null when the context cannot be created. */
export function createWebGL2Context(canvas: HTMLCanvasElement, antialias = false): WebGL2RenderingContext | null {
  try {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias,
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

export function createGameRenderer(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, theme: ThemeJson, antialias = false): GameRenderer {
  const renderer = new WebGLRenderer({ canvas, context: gl, antialias, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.setClearColor(new Color(theme.sky.bottom), 1);

  const scene = new Scene();
  scene.background = new Color(theme.sky.bottom);
  scene.fog = new Fog(new Color(theme.fog.color), theme.fog.near, theme.fog.far);

  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 400);
  camera.position.set(0, 6, -12);
  camera.lookAt(0, 1, 20);

  const hemi = new HemisphereLight(new Color(theme.sky.top), new Color(theme.materials['track']?.color ?? '#ffffff'), 0.6);
  scene.add(hemi);
  const ambient = new AmbientLight(new Color(theme.light.ambient), theme.light.ambientIntensity * 0.5);
  scene.add(ambient);
  const sun = new DirectionalLight(new Color(theme.light.sun), theme.light.sunIntensity);
  sun.position.set(theme.light.sunDir[0] * 60, theme.light.sunDir[1] * 60, theme.light.sunDir[2] * 60);
  sun.castShadow = false;
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  scene.add(sun.target);

  // Far ground below the track: horizon filler in the track colour.
  const ground = new Mesh(
    new PlaneGeometry(1200, 2400, 1, 1),
    new MeshLambertMaterial({ color: new Color(theme.materials['border']?.color ?? '#ffffff') }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -6, 600);
  ground.receiveShadow = false;
  scene.add(ground);

  const glRenderer = describeGl(gl);
  const sunDir = new Vector3(theme.light.sunDir[0], theme.light.sunDir[1], theme.light.sunDir[2]).normalize();

  return {
    renderer,
    scene,
    camera,
    sun,
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
    applyQuality(q) {
      const fog = scene.fog as Fog;
      fog.far = q.fogFar;
      fog.near = Math.min(theme.fog.near, q.fogFar * 0.4);
      const shadows = q.shadowMap > 0;
      if (renderer.shadowMap.enabled !== shadows) {
        renderer.shadowMap.enabled = shadows;
        renderer.shadowMap.needsUpdate = true;
      }
      sun.castShadow = shadows;
      if (shadows && sun.shadow.mapSize.x !== q.shadowMap) {
        sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
    },
    follow(target) {
      sun.position.copy(target).addScaledVector(sunDir, 60);
      sun.target.position.copy(target);
      sun.target.updateMatrixWorld();
      ground.position.z = target.z;
      ground.position.x = target.x;
    },
    dispose() {
      renderer.dispose();
    },
  };
}
