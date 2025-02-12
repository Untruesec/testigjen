// index.js
import * as THREE from "three";
import { OrbitControls } from "jsm/controls/OrbitControls.js";
import getStarfield from "./src/getStarfield.js"; // Ensure this file exists!

/* ========== SCENE, CAMERA, RENDERER ========== */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 0, 3.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

const orbitCtrl = new OrbitControls(camera, renderer.domElement);
orbitCtrl.enableDamping = true;

/* ========== GLOBE GROUP ========== */
const globeGroup = new THREE.Group();
scene.add(globeGroup);

/* --------- Create a Base Globe Mesh (Wireframe) --------- */
const globeGeometry = new THREE.IcosahedronGeometry(1, 10);
const globeMaterial = new THREE.MeshBasicMaterial({
  color: 0x202020,
  wireframe: true,
});
const globeMesh = new THREE.Mesh(globeGeometry, globeMaterial);
globeGroup.add(globeMesh);

/* --------- Add a Points Cloud with a Shader Material --------- */
const textureLoader = new THREE.TextureLoader();
const colorMap = textureLoader.load("./src/04_rainbow1k.jpg");
const elevMap = textureLoader.load("./src/01_earthbump1k.jpg");
const alphaMap = textureLoader.load("./src/02_earthspec1k.jpg");

const detail = 120;
const pointsGeometry = new THREE.IcosahedronGeometry(1, detail);

const vertexShader = `
  uniform float size;
  uniform sampler2D elevTexture;
  varying vec2 vUv;
  varying float vVisible;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    float elv = texture2D(elevTexture, vUv).r;
    vec3 vNormal = normalMatrix * normal;
    vVisible = step(0.0, dot( -normalize(mvPosition.xyz), normalize(vNormal)));
    mvPosition.z += 0.35 * elv;
    gl_PointSize = size;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  uniform sampler2D colorTexture;
  uniform sampler2D alphaTexture;
  varying vec2 vUv;
  varying float vVisible;
  void main() {
    if (floor(vVisible + 0.1) == 0.0) discard;
    float alpha = 1.0 - texture2D(alphaTexture, vUv).r;
    vec3 color = texture2D(colorTexture, vUv).rgb;
    gl_FragColor = vec4(color, alpha);
  }
`;

const uniforms = {
  size: { value: 4.0 },
  colorTexture: { value: colorMap },
  elevTexture: { value: elevMap },
  alphaTexture: { value: alphaMap },
};

const pointsMaterial = new THREE.ShaderMaterial({
  uniforms: uniforms,
  vertexShader,
  fragmentShader,
  transparent: true,
});

const pointsMesh = new THREE.Points(pointsGeometry, pointsMaterial);
globeGroup.add(pointsMesh);

/* --------- Add Lighting and Starfield --------- */
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x080820, 3);
scene.add(hemiLight);

const starSprite = textureLoader.load("./src/circle.png");
const stars = getStarfield({ numStars: 4500, sprite: starSprite });
scene.add(stars);

/* ========== ATTACK ANIMATION VARIABLES ========== */
let animationSpeed = 1;
const animatedLines = [];
const explosions = [];

/* ========== HELPER FUNCTIONS ========== */
function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function coordinatesToVector3([lon, lat], radius = 1, altitude = 0) {
  const phi = degToRad(90 - lat);
  const theta = degToRad(lon + 180);
  const r = radius + altitude;
  const x = -r * Math.sin(phi) * Math.cos(theta);
  const z = r * Math.sin(phi) * Math.sin(theta);
  const y = r * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

function createGreatCircleArc(start, end, segments = 80, altitude = 0.15) {
  const arcPoints = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const intermediate = new THREE.Vector3().copy(start).lerp(end, t).normalize();
    const height = Math.sin(t * Math.PI) * altitude;
    intermediate.multiplyScalar(1 + height);
    arcPoints.push(intermediate);
  }
  return arcPoints;
}

function getAttackColor(attackType) {
  switch (attackType) {
    case "Phishing":
      return 0xff2f92; // Neon pink
    case "Malware":
      return 0x00ffe9; // Bright aqua
    case "DDoS":
      return 0xfff000; // Bright yellow
    case "SQL Injection":
      return 0xc800ff; // Neon purple
    default:
      return 0xffffff;
  }
}

/* ========== ATTACK LINE AND EXPLOSION CREATION ========== */
function createAttackLine(startCoord, endCoord, attackType = "Phishing") {
  const start = coordinatesToVector3(startCoord, 1, 0);
  const end = coordinatesToVector3(endCoord, 1, 0);
  const arcPoints = createGreatCircleArc(start, end, 100, 0.15);
  const geometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
  const color = getAttackColor(attackType);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 1,
  });
  const line = new THREE.Line(geometry, material);
  globeGroup.add(line);

  // Create comet head particle
  const particleGeometry = new THREE.SphereGeometry(0.02, 16, 16);
  const particleMaterial = new THREE.MeshBasicMaterial({ color, emissive: color });
  const particle = new THREE.Mesh(particleGeometry, particleMaterial);
  globeGroup.add(particle);

  const attack = {
    line,
    particle,
    progress: 0,
    speed: 0.015 * animationSpeed,
    trailLength: 0.2,
    finished: false,
    positions: geometry.attributes.position.array,
  };
  animatedLines.push(attack);
}

function createExplosion(position, color = 0xffffff) {
  const geometry = new THREE.RingGeometry(0.01, 0.02, 32);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 1,
  });
  const ring = new THREE.Mesh(geometry, material);
  ring.position.copy(position);
  globeGroup.add(ring);
  explosions.push({ ring, scaleSpeed: 0.02, alphaSpeed: 0.04 });
}

/* ========== ANIMATION LOOP ========== */
function animate() {
  requestAnimationFrame(animate);

  // Rotate the globe
  globeGroup.rotation.y += 0.002 * animationSpeed;

  // Animate attack beams
  animatedLines.forEach((attack) => {
    if (attack.finished) return;

    attack.progress += attack.speed;
    attack.line.material.opacity = Math.max(0.2, 1 - attack.progress * 1.2);

    const positions = attack.positions;
    const numPoints = positions.length / 3;
    const indexPos = Math.floor(attack.progress * (numPoints - 1));
    const t = attack.progress * (numPoints - 1) - indexPos;
    const clampedIndex = THREE.MathUtils.clamp(indexPos, 0, numPoints - 2);

    const startPoint = new THREE.Vector3(
      positions[clampedIndex * 3],
      positions[clampedIndex * 3 + 1],
      positions[clampedIndex * 3 + 2]
    );
    const endPoint = new THREE.Vector3(
      positions[(clampedIndex + 1) * 3],
      positions[(clampedIndex + 1) * 3 + 1],
      positions[(clampedIndex + 1) * 3 + 2]
    );
    const interpolated = new THREE.Vector3().lerpVectors(startPoint, endPoint, t);
    attack.particle.position.copy(interpolated);

    if (attack.progress >= 1.0) {
      attack.finished = true;
      createExplosion(interpolated, attack.line.material.color);
      attack.particle.visible = false;
    }
  });

  // Animate explosions (scale and fade)
  explosions.forEach((exp, i) => {
    exp.ring.scale.addScalar(exp.scaleSpeed * animationSpeed);
    exp.ring.material.opacity -= exp.alphaSpeed * animationSpeed;
    if (exp.ring.material.opacity <= 0) {
      globeGroup.remove(exp.ring);
      explosions.splice(i, 1);
    }
  });

  orbitCtrl.update();
  renderer.render(scene, camera);
}
animate();

/* ========== EVENT LISTENERS FOR UI ========== */
// Attack Speed Slider
const speedSlider = document.getElementById("speedSlider");
const speedValue = document.getElementById("speedValue");
speedSlider.addEventListener("input", (e) => {
  animationSpeed = parseFloat(e.target.value);
  speedValue.textContent = e.target.value + "x";
});

// New Attack Button (example: New York → Tokyo, DDoS attack)
document.getElementById("newAttackBtn").addEventListener("click", () => {
  createAttackLine([-74.006, 40.7128], [139.6917, 35.6895], "DDoS");
});

// Clear Attacks Button
document.getElementById("clearAttacksBtn").addEventListener("click", () => {
  animatedLines.forEach((attack) => {
    globeGroup.remove(attack.line);
    globeGroup.remove(attack.particle);
  });
  animatedLines.length = 0;
  explosions.forEach((exp) => {
    globeGroup.remove(exp.ring);
  });
  explosions.length = 0;
});

// Attack Creation from UI Dropdowns (if you want to use custom cities)
const cityCoordinates = {
  "New York": [-74.006, 40.7128],
  London: [-0.1276, 51.5074],
  Sydney: [151.2093, -33.8688],
  Tokyo: [139.6917, 35.6895],
  Paris: [2.3522, 48.8566],
  Cairo: [31.2357, 30.0444],
  "Rio de Janeiro": [-43.1729, -22.9068],
};

document.getElementById("addAttackBtn").addEventListener("click", () => {
  const sourceCity = document.getElementById("sourceCity").value;
  const targetCity = document.getElementById("targetCity").value;
  if (sourceCity && targetCity && cityCoordinates[sourceCity] && cityCoordinates[targetCity]) {
    createAttackLine(cityCoordinates[sourceCity], cityCoordinates[targetCity], "Phishing");
  }
});

/* ========== WINDOW RESIZE ========== */
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
