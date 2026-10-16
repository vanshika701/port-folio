// ============================================================
//  Intro: the name is made of glowing particles. The first
//  downward scroll is held while the name bursts into a 3D
//  vortex, then normal scrolling resumes. Scrolling back to
//  the top pulls the particles back into the name.
// ============================================================

const body = document.body;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const WARP_MS = 1600;

// Always start at the top so the intro plays on every load
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.scrollTo(0, 0);

// 'armed' -> waiting for first scroll, 'warping' -> animation playing, 'done' -> free scrolling
let state = reduceMotion ? "done" : "armed";
let leftHero = false; // becomes true once the user has scrolled past the hero after the intro
if (state === "done") body.classList.remove("locked");

// ---------- Burst progress tween (0 = name, 1 = vortex) ----------
let warp = reduceMotion ? 1 : 0;
let tween = null;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function tweenWarp(to, duration) {
  tween = { from: warp, to, start: performance.now(), duration };
}
function updateTween(now) {
  if (!tween) return;
  const t = Math.min((now - tween.start) / tween.duration, 1);
  // Linear here: each particle applies its own easing and delay in the shader
  warp = tween.from + (tween.to - tween.from) * t;
  if (t === 1) tween = null;
}

function playIntro(target = document.querySelector("#about")) {
  if (state !== "armed") return;
  state = "warping";
  body.classList.add("warping");
  tweenWarp(1, WARP_MS);

  setTimeout(() => {
    body.classList.remove("locked");
    state = "done";
    leftHero = false;
    requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth" }));
  }, WARP_MS * 0.85);
}

function rearmIntro() {
  state = "armed";
  body.classList.add("locked");
  body.classList.remove("warping");
  tweenWarp(0, 1600);
}

// ---------- Input that triggers the intro ----------
window.addEventListener(
  "wheel",
  (e) => {
    if (state === "done") return;
    e.preventDefault();
    if (e.deltaY > 0) playIntro();
  },
  { passive: false }
);

let touchStartY = 0;
window.addEventListener("touchstart", (e) => (touchStartY = e.touches[0].clientY), { passive: true });
window.addEventListener(
  "touchmove",
  (e) => {
    if (state === "done") return;
    e.preventDefault();
    if (touchStartY - e.touches[0].clientY > 25) playIntro();
  },
  { passive: false }
);

window.addEventListener("keydown", (e) => {
  if (state === "done") return;
  if (["ArrowDown", "PageDown", " ", "End"].includes(e.key)) {
    e.preventDefault();
    playIntro();
  }
});

// Nav links play the intro first, then go to their section
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (e) => {
    const href = link.getAttribute("href");
    if (href === "#") return e.preventDefault(); // placeholder link, not filled in yet
    const target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();
    if (state === "armed" && target.id !== "hero") playIntro(target);
    else if (state === "done") target.scrollIntoView({ behavior: "smooth" });
  });
});

// Coming back to the very top re-arms the intro so it can play again
window.addEventListener("scroll", () => {
  if (state !== "done" || reduceMotion) return;
  if (window.scrollY > window.innerHeight * 0.5) leftHero = true;
  if (leftHero && window.scrollY <= 1) rearmIntro();
});

// ============================================================
//  Three.js particle scene
// ============================================================

const mouseNdc = { x: 10, y: 10 }; // starts off-screen so nothing is pushed
window.addEventListener("mousemove", (e) => {
  mouseNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
});
document.addEventListener("mouseleave", () => (mouseNdc.x = mouseNdc.y = 10));

const NAME = "Vanshika Srivastava";
const NAME_FONT = '"Syne"';
const CAM_Z = 10;
const FOV = 45;

if (window.THREE) {
  // Wait (briefly) for the display font so the particles trace the right letterforms
  Promise.race([
    document.fonts.load(`700 200px ${NAME_FONT}`),
    new Promise((r) => setTimeout(r, 2500)),
  ]).then(initScene);
}

function initScene() {
  body.classList.add("webgl");

  const canvas = document.getElementById("scene");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.z = CAM_Z;

  const isSmall = window.innerWidth < 700;
  const COUNT = isSmall ? 7000 : 14000;

  // --- Name particles ---
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: warp },
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(100, 100) },
      uPixelRatio: { value: pixelRatio },
      uSizeScale: { value: isSmall ? 16 : 22 },
    },
    vertexShader: /* glsl */ `
      uniform float uProgress;
      uniform float uTime;
      uniform vec2 uMouse;
      uniform float uPixelRatio;
      uniform float uSizeScale;
      attribute vec3 aBurst;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aDelay;
      attribute float aRand;
      varying vec3 vColor;
      varying float vAlpha;

      float ease(float t) {
        return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
      }
      mat2 rot(float a) {
        float c = cos(a), s = sin(a);
        return mat2(c, -s, s, c);
      }

      void main() {
        float e = ease(clamp((uProgress - aDelay) / 0.6, 0.0, 1.0));

        // Resting in the name: shimmer, and get pushed away by the cursor
        vec3 start = position;
        start.xy += 0.025 * vec2(sin(uTime * 1.3 + aRand * 40.0), cos(uTime * 1.1 + aRand * 30.0));
        vec2 away = start.xy - uMouse;
        float push = 1.0 - smoothstep(0.0, 1.3, length(away));
        start.xy += normalize(away + 0.0001) * push * 0.7;
        start.z += push * (aRand - 0.5) * 1.5;

        // Settled in the vortex: slow rotation, inner rings turn faster
        vec3 burst = aBurst;
        burst.xy = rot(uTime * (0.05 + 0.25 / (1.0 + length(aBurst.xy)))) * burst.xy;

        // In flight: swirl around the axis and lunge toward the viewer
        vec3 p = mix(start, burst, e);
        float flight = sin(e * 3.14159);
        p.xy = rot(flight * (aRand - 0.5) * 2.5) * p.xy;
        p.z += flight * (2.0 + aRand * 7.0);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        gl_PointSize = min(aSize * uSizeScale * uPixelRatio / dist, 70.0 * uPixelRatio);
        gl_Position = projectionMatrix * mv;

        vColor = aColor * (1.0 + flight * 0.6);
        // Fade particles that get too close to the lens, and twinkle a little
        vAlpha = smoothstep(0.2, 2.5, dist) * (0.7 + 0.3 * sin(uTime * 2.0 + aRand * 60.0));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = pow(1.0 - d * 2.0, 1.7);
        gl_FragColor = vec4(vColor, a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(buildNameGeometry(COUNT, camera), material);
  scene.add(points);

  // --- Background dust for depth ---
  const DUST = isSmall ? 600 : 1400;
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 60;
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 40;
    dustPos[i * 3 + 2] = -10 - Math.random() * 60;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      size: 0.12,
      map: makeDotTexture(),
      color: 0x4f7fe0,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  scene.add(dust);

  // --- Loop ---
  const mouseWorld = new THREE.Vector2(100, 100);
  const ray = new THREE.Vector3();

  function animate(now) {
    updateTween(now);
    const time = now * 0.001;
    const flight = Math.sin(Math.min(warp, 1) * Math.PI);

    // Project the cursor onto the z = 0 plane where the name lives
    if (Math.abs(mouseNdc.x) <= 1) {
      ray.set(mouseNdc.x, mouseNdc.y, 0.5).unproject(camera).sub(camera.position).normalize();
      const t = -camera.position.z / ray.z;
      mouseWorld.x += (camera.position.x + ray.x * t - mouseWorld.x) * 0.15;
      mouseWorld.y += (camera.position.y + ray.y * t - mouseWorld.y) * 0.15;
    } else {
      mouseWorld.set(100, 100);
    }

    material.uniforms.uProgress.value = warp;
    material.uniforms.uTime.value = time;
    material.uniforms.uMouse.value.copy(mouseWorld);

    // Gentle camera sway, a lens "kick" mid-burst, and a slow turn as the page scrolls
    const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    const scrollP = window.scrollY / maxScroll;
    const mx = Math.abs(mouseNdc.x) <= 1 ? mouseNdc.x : 0;
    const my = Math.abs(mouseNdc.y) <= 1 ? mouseNdc.y : 0;
    camera.position.x += (mx * 0.4 - camera.position.x) * 0.03;
    camera.position.y += (my * 0.3 - camera.position.y) * 0.03;
    camera.position.z = CAM_Z - flight * 2.5;
    camera.fov = FOV + flight * 22;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, -10);

    points.rotation.z = scrollP * 1.2;
    dust.rotation.z = time * 0.01 + scrollP * 0.5;

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  let resizeTimer;
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      points.geometry.dispose();
      points.geometry = buildNameGeometry(COUNT, camera);
    }, 200);
  });
}

// Sample the name's pixels and give every particle a home in the name
// plus a destination in the vortex.
function buildNameGeometry(count, camera) {
  // Visible area of the z = 0 plane
  const visH = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const visW = visH * camera.aspect;
  const lines = camera.aspect < 1 ? NAME.split(" ") : [NAME];

  // Rasterise the name on an offscreen canvas
  const fontPx = 200;
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  g.font = `700 ${fontPx}px ${NAME_FONT}, sans-serif`;
  const textW = Math.max(...lines.map((l) => g.measureText(l).width));
  const lineH = fontPx * 1.05;
  c.width = Math.ceil(textW + 40);
  c.height = Math.ceil(lineH * lines.length + 40);
  g.font = `700 ${fontPx}px ${NAME_FONT}, sans-serif`;
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((l, i) => g.fillText(l, c.width / 2, 20 + lineH * (i + 0.5)));

  const data = g.getImageData(0, 0, c.width, c.height).data;
  const filled = [];
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x += 2) {
      if (data[(y * c.width + x) * 4 + 3] > 128) filled.push(x, y);
    }
  }

  // Scale the name to ~82% of the screen width (capped so it isn't huge on wide screens)
  const worldW = Math.min(visW * 0.82, 13);
  const scale = worldW / textW;
  const nameWorldH = lineH * lines.length * scale;
  document.documentElement.style.setProperty(
    "--name-space",
    `${(nameWorldH / visH) * window.innerHeight}px`
  );

  const pos = new Float32Array(count * 3);
  const burst = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const delay = new Float32Array(count);
  const rand = new Float32Array(count);

  const deep = new THREE.Color(0x2a5cff);
  const soft = new THREE.Color(0x8fb6ff);
  const white = new THREE.Color(0xe7eeff);
  const tmp = new THREE.Color();
  const pixels = filled.length / 2;

  for (let i = 0; i < count; i++) {
    const k = Math.floor(Math.random() * pixels) * 2;
    const x = (filled[k] - c.width / 2 + Math.random() * 2) * scale;
    const y = -(filled[k + 1] - c.height / 2 + Math.random() * 2) * scale;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 0.15;

    // Vortex: three spiral arms streaming away from the viewer
    const r = 1.2 + Math.pow(Math.random(), 0.8) * 16;
    const arm = Math.floor(Math.random() * 3);
    const angle = (arm / 3) * Math.PI * 2 + r * 0.32 + (Math.random() - 0.5) * 0.6;
    burst[i * 3] = Math.cos(angle) * r;
    burst[i * 3 + 1] = Math.sin(angle) * r * 0.75;
    burst[i * 3 + 2] = -r * 1.6 + (Math.random() - 0.5) * 6 + 2;

    const roll = Math.random();
    tmp.copy(roll < 0.12 ? white : deep).lerp(soft, roll < 0.12 ? 0.2 : Math.random());
    color[i * 3] = tmp.r;
    color[i * 3 + 1] = tmp.g;
    color[i * 3 + 2] = tmp.b;

    size[i] = 0.8 + Math.random() * 1.6;
    rand[i] = Math.random();
    // Burst sweeps left-to-right with some randomness
    delay[i] = Math.random() * 0.22 + ((x / worldW) + 0.5) * 0.18;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aBurst", new THREE.BufferAttribute(burst, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aDelay", new THREE.BufferAttribute(delay, 1));
  geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
  return geo;
}

function makeDotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ============================================================
//  Section reveal + word-by-word lighting of the about statement
// ============================================================

const observer = new IntersectionObserver(
  (entries) =>
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    }),
  { threshold: 0.15 }
);
document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

// Wrap each word in a span (an <em> counts as one word)
document.querySelectorAll("[data-words]").forEach((el) => {
  const frag = document.createDocumentFragment();
  [...el.childNodes].forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      node.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) return frag.append(" ");
        const w = document.createElement("span");
        w.className = "w";
        w.textContent = part;
        frag.append(w);
      });
    } else {
      const w = document.createElement("span");
      w.className = "w";
      w.append(node);
      frag.append(w);
    }
  });
  el.replaceChildren(frag);
});

const statements = [...document.querySelectorAll("[data-words]")].map((el) => ({
  el,
  words: [...el.querySelectorAll(".w")],
}));
function lightWords() {
  statements.forEach(({ el, words }) => {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const progress = Math.min(Math.max((vh * 0.85 - r.top) / (r.height + vh * 0.3), 0), 1);
    const lit = Math.round(progress * words.length);
    words.forEach((w, i) => w.classList.toggle("lit", i < lit));
  });
}
window.addEventListener("scroll", lightWords, { passive: true });
lightWords();

// Highlight the nav link for the section on screen
const navLinks = [...document.querySelectorAll('.nav a[href^="#"]')].filter((a) => a.getAttribute("href") !== "#");
const sectionObserver = new IntersectionObserver(
  (entries) =>
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${entry.target.id}`));
    }),
  { rootMargin: "-45% 0px -45% 0px" }
);
document.querySelectorAll("main section[id]").forEach((sec) => sectionObserver.observe(sec));

// Shrink the nav once the visitor has scrolled past the intro
function updateNavSize() {
  body.classList.toggle("nav-compact", window.scrollY > window.innerHeight * 0.6);
}
window.addEventListener("scroll", updateNavSize, { passive: true });
updateNavSize();

// ============================================================
//  Projects: swipeable card stack + full-screen gallery
//  Edit this list to change projects. Put a screenshot at
//  `img` and it replaces the generated artwork automatically.
// ============================================================

const PROJECTS = [
  {
    title: "PropVisit",
    glyph: "PV",
    desc: "Property listings and site-visit booking: buyers book visits, agents manage listings and requests in a live dashboard.",
    tags: ["Python", "React", "PostgreSQL", "Redis", "Docker"],
    img: "",
    link: "https://github.com/vanshika701/Real-estate-platform",
    colors: ["#5fe0a0", "#06281a"],
    details: {
      overview: [
        "A real-estate platform where buyers browse listings and book site visits, and agents manage their listings and handle visit requests from a live dashboard.",
        "Work in progress: the full write-up with architecture, design decisions and load-test results is coming.",
      ],
      sections: [
        {
          title: "Engineering",
          items: [
            "Python API served with uvicorn, versioned under /api/v1 with interactive docs.",
            "PostgreSQL 16 and Redis 7, with the whole stack runnable through Docker Compose.",
            "Tested end to end: pytest, Vitest + React Testing Library, Playwright, plus linting and type-checks in CI.",
            "Deploy plan on free tiers: Vercel (frontend), Render (API + worker), Supabase (Postgres + storage), Upstash (Redis).",
          ],
        },
      ],
      stack: ["Python", "React", "TypeScript", "PostgreSQL", "Redis", "Docker", "pytest", "Vitest", "Playwright", "GitHub Actions"],
    },
  },
  {
    title: "RAKSHAK",
    glyph: "RK",
    desc: "Real-time ML intrusion detection for defence networks: a soft-voting ensemble that classifies live traffic into attack types.",
    tags: ["Python", "XGBoost", "LightGBM", "Scapy", "Flask"],
    img: "",
    link: "https://github.com/vanshika701/RAKSHAK",
    colors: ["#ff5f7a", "#2a0b1a"],
    details: {
      overview: [
        "A network intrusion detection system built during a 6-week internship. It captures live traffic, rebuilds flows, and classifies each one as normal or as a DoS, Probe, R2L or U2R attack, in real time.",
        "The model is a soft-voting ensemble of XGBoost, LightGBM and Random Forest, trained on CICIDS2017 and stress-tested against a second dataset (UNSW-NB15) to see how well it generalises.",
      ],
      metrics: [
        ["0.9985", "weighted F1 on the untouched test set"],
        ["0.9259", "macro F1 across all attack classes"],
        ["78.3%", "recall on rare U2R attacks at the tuned threshold"],
        ["25", "flow features extracted live from captured packets"],
      ],
      sections: [
        {
          title: "How it works",
          items: [
            "Preprocessing pipeline cleans the data, engineers features and saves parquet files.",
            "Training handles feature selection, scaling and SMOTE for class imbalance; XGBoost and LightGBM were tuned separately.",
            "Live capture with Scapy reconstructs flows; the detector classifies finished flows and logs them to SQLite.",
            "A Flask dashboard reads the detections and refreshes every 5 seconds.",
          ],
        },
        {
          title: "Honest limitations",
          items: [
            "U2R is the weak spot (56.8% precision / 78.3% recall at the tuned threshold) because CICIDS2017 has only ~1,587 real U2R examples.",
            "Zero-shot transfer to UNSW-NB15 drops weighted F1 from 97.7% to 39.9%: distribution shift between datasets is real.",
            "Live flow reconstruction approximates a few CICFlowMeter conventions.",
          ],
        },
      ],
      stack: ["Python", "pandas", "scikit-learn", "XGBoost", "LightGBM", "SMOTE", "Scapy", "Flask", "SQLite", "Jupyter", "Google Colab"],
    },
  },
  {
    title: "Insurance Claims Analytics",
    glyph: "IC",
    desc: "Found where fraud hides in 1,000 auto-insurance claims with SQL + Python, then built an AI claims-investigator copilot on MCP.",
    tags: ["SQL", "Python", "XGBoost", "RAG", "MCP"],
    img: "images/insurance.jpg",
    imgPos: "center 42%",
    link: "https://github.com/vanshika701/Insurance-Claim-Analytics",
    colors: ["#2fd3c4", "#062a33"],
    // Full write-up shown in the details panel
    details: {
      overview: [
        "I normalised a public auto-insurance claims dataset (1,000 claims, 39 columns) into a four-table relational schema (policies, vehicles, incidents, claims), then used SQL and Python to find where fraud actually concentrates, and which \"obvious\" red flags turn out to be dead ends.",
        "Part two turns the analysis into an AI claims-investigator copilot: an MCP server that gives Claude safe SQL access, a fraud-risk model with per-claim explanations, and search over insurance regulations.",
      ],
      metrics: [
        ["68%", "of all fraud caught by a one-line \"Major Damage\" rule (61% precision)"],
        ["0.77", "ROC-AUC: ML models tied the simple rule, and I report that honestly"],
        ["47", "passing tests, including 19 SQL-injection and bypass attempts"],
        ["0.95", "hit@5 for the hybrid RAG search over regulatory guidelines"],
      ],
      sections: [
        {
          title: "Key findings",
          items: [
            "Major Damage collisions show 58–63% fraud vs 6–13% elsewhere: 28% of claims hold 68% of the fraud.",
            "At the same severity, fraudulent and legitimate claims differ by only ~$120, so fraud lives in fabricated incidents, not inflated amounts.",
            "Claim size, policy age, state and demographics carry little signal; a z-score anomaly detector caught just 0.4% of fraud.",
            "Caught a data leak: the insured_hobbies field inflated AUC to ~0.86, so it was excluded from the shipped model.",
          ],
        },
        {
          title: "AI claims-investigator copilot",
          items: [
            "Read-only SQL tool guarded by an AST check (sqlglot).",
            "XGBoost fraud-risk model with SHAP explanations for every claim.",
            "Hybrid RAG (BM25 + vectors + reciprocal rank fusion) over IRDAI and California DOI guidelines.",
            "Evaluation harness that runs through a real MCP client over stdio.",
          ],
        },
        {
          title: "Honest limitations",
          items: [
            "Single 1,000-row dataset with a 24.7% fraud rate, far above real portfolios, so results are relative comparisons, not production metrics.",
            "The model's value is in its per-claim explanations, not in beating the rule.",
            "Small RAG corpus (two documents), and the eval questions favour keyword matching.",
          ],
        },
      ],
      stack: ["MySQL", "SQLite", "pandas", "NumPy", "scikit-learn", "XGBoost", "SHAP", "ChromaDB", "MiniLM embeddings", "BM25", "sqlglot", "MCP", "pytest"],
    },
  },
  {
    title: "The Route Cause",
    glyph: "RC",
    desc: "AI traffic signals for Smart India Hackathon 2025: YOLOv8 sees the junction, a Q-learning agent times the lights.",
    tags: ["YOLOv8", "Q-Learning", "FastAPI", "React"],
    img: "",
    link: "https://github.com/vanshika701/The-Route-Cause",
    colors: ["#ffb547", "#2a1a04"],
    details: {
      overview: [
        "Our Smart India Hackathon 2025 submission: replace fixed traffic-light timers with adaptive control that reacts to real congestion and gives way to emergency vehicles.",
        "A computer-vision layer counts vehicles and pedestrians, a reinforcement-learning agent picks signal timings, and a rule-based supervisor checks every decision for safety and fairness before it's applied.",
      ],
      sections: [
        {
          title: "Architecture",
          items: [
            "Perception: YOLOv8 detects and counts vehicles and pedestrians in real time.",
            "Decision: a Q-learning agent chooses green-light allocation from live density.",
            "Supervision: a rule engine enforces safety and fairness constraints on the agent.",
            "Output: FastAPI streams everything over WebSockets to a live React dashboard.",
          ],
        },
        {
          title: "Features",
          items: [
            "Emergency-vehicle preemption with a yellow → all-red → dedicated-green sequence.",
            "Queue management that overrides the normal cycle when queues grow long.",
            "A starvation timer so no direction waits indefinitely.",
          ],
        },
      ],
      stack: ["Python", "OpenCV", "PyTorch", "YOLOv8", "Q-Learning", "FastAPI", "WebSockets", "React", "TypeScript", "Vite", "Tailwind CSS", "Recharts"],
    },
  },
  {
    title: "SONIC",
    glyph: "SN",
    desc: "Network immunisation that finds where an epidemic started with a GNN, then removes the nodes that best contain its spread.",
    tags: ["PyTorch", "GNN", "Graph Theory", "networkx"],
    img: "",
    link: "https://github.com/vanshika701/SONIC",
    colors: ["#b07bff", "#1a0b38"],
    details: {
      overview: [
        "SONIC combines two ideas: DINO (structural immunisation by shrinking the network's spectral radius) and DeepTrace (a GNN that infers where an epidemic started). It locates the likely source, estimates how the spread will move from there, and removes a set of nodes to contain it.",
        "Each node gets a composite score that blends how much removing it shrinks the spectral radius with how exposed it is to the inferred source, and nodes are removed greedily.",
      ],
      metrics: [
        ["20.84", "Δρ on the real Reddit network, ahead of Degree (19.68) and DINO (0.00)"],
        ["27%", "improvement over pure DINO when source-risk is weighted in (ablation)"],
        ["96.7%", "top-5 source-detection accuracy (Rumor Centrality, BA graphs)"],
        ["3", "phases: source detection → source risk → composite removal"],
      ],
      sections: [
        {
          title: "How it works",
          items: [
            "Source detection with a DeepTrace GNN (GraphSAGE + LSTM), falling back to Rumor Centrality when no trained model exists.",
            "Source risk from Expected Personalised PageRank over the top-K candidate sources.",
            "Score(v) = α × Δρ(v) + β × SourceRisk(v), with greedy removal from the largest strongly connected component.",
            "CLI with baselines (DINO, degree, random), an adaptive mode, β ablation and budget sweeps, plus SIS simulation.",
          ],
        },
        {
          title: "Honest limitations",
          items: [
            "The real HIV network needs restricted access, so most HIV experiments use a synthetic graph matched to the paper's statistics.",
            "On the synthetic HIV graph, Degree edges out SONIC slightly (4.59 vs 4.56 Δρ).",
          ],
        },
      ],
      stack: ["Python", "PyTorch", "torch-geometric", "networkx", "NumPy", "SciPy", "pandas", "scikit-learn", "Streamlit", "Jupyter"],
    },
  },
  {
    title: "Content-Aware Cache",
    glyph: "CA",
    desc: "A file-I/O caching library that decides what to keep by file type, size and access pattern, not just recency like LRU.",
    tags: ["Java", "Algorithms", "Systems"],
    img: "",
    link: "https://github.com/vanshika701/Content-Aware-caching-algo",
    colors: ["#3dd6ff", "#04223a"],
    details: {
      overview: [
        "A user-space Java library that adds a smarter caching layer to file I/O. Instead of evicting purely by recency (LRU) or frequency (LFU), it scores files using their type, size, access frequency and a time-decay factor, so important small files stay hot.",
        "It ships with an interactive CLI and a benchmark harness that runs it head-to-head against a standard LRU cache.",
      ],
      metrics: [
        ["74.5%", "hit rate on a realistic workload, vs 46.4% for LRU"],
        ["93.2%", "hit rate on an important-files burst, vs 78.3% for LRU"],
        ["+28pts", "hit-rate gain over LRU on the realistic workload"],
        ["25%", "cache size relative to total data in the benchmarks"],
      ],
      sections: [
        {
          title: "Features",
          items: [
            "Content-aware prioritisation by extension, size, frequency and recency decay.",
            "Configurable per-type priorities (0.0–1.0) at runtime.",
            "Live stats: hit rate, disk I/O operations and cache utilisation.",
            "File handles with read, write, seek, tell, flush and close.",
          ],
        },
        {
          title: "Benchmark setup",
          items: [
            "100 generated files with synthetic access patterns: 20,000 accesses (realistic) and 10,000 (burst), seeded for reproducibility.",
            "Next steps: a FUSE layer, adaptive learning of access patterns, and a kernel-module version.",
          ],
        },
      ],
      stack: ["Java 17", "Make"],
    },
  },
  {
    title: "TA Doubt Triage",
    glyph: "TA",
    desc: "Groups a whole class's doubts with Gemini, ranks them most-asked first, and emails the TA a ready-made session agenda.",
    tags: ["Apps Script", "Gemini", "Google Workspace"],
    img: "",
    link: "https://github.com/vanshika701/TA-doubt-triage",
    colors: ["#4f8bff", "#0a1a44"],
    details: {
      overview: [
        "Built for my own TA work on an AI course with 50+ students. Doubts come in through a Google Form; before each weekly session this script clusters similar questions with Gemini, orders them by how many students asked, and emails me a Google Doc agenda.",
        "It redacts personal details before anything reaches the model, keeps clusters stable across weeks, and can send students a follow-up summary after the session.",
      ],
      metrics: [
        ["50+", "students whose doubts are triaged every week"],
        ["100", "doubts processed per run"],
        ["24", "end-to-end test scenarios against mocked Google services"],
        ["0", "names, roll numbers, emails or phones sent to the model"],
      ],
      sections: [
        {
          title: "How it works",
          items: [
            "New responses get permanent IDs, are redacted, and are sent to Gemini 2.5 Flash with a strict JSON response schema.",
            "Output is validated; a failure retries once, then is logged without touching any data.",
            "Valid clusters merge into a Clusters sheet, and code (not the model) recounts students and sets the order.",
            "A custom menu and weekly trigger handle processing, archiving covered clusters and emailing summaries.",
          ],
        },
        {
          title: "Honest limitations",
          items: [
            "Consumer Gmail allows ~100 recipients a day, so emails go out in batches of 49 plus the TA.",
            "Time-driven triggers can fire about ±15 minutes off schedule.",
            "Test fakes aren't Google's servers, so a first run on a real sheet is still required.",
          ],
        },
      ],
      stack: ["Google Apps Script", "Gemini 2.5 Flash", "Google Sheets", "Google Docs", "Google Forms", "Gmail", "clasp", "Node.js"],
    },
  },
  {
    title: "Markly",
    glyph: "MK",
    desc: "AI that grades student assignments and marks them up like a teacher, word by word.",
    tags: ["Python", "AI", "EdTech"],
    img: "",
    link: "https://github.com/vanshika701/Markly",
    colors: ["#ff7ad9", "#2a0a24"],
  },
  {
    title: "Pharmacy Management",
    glyph: "PM",
    desc: "Runs a pharmacy end to end: drug inventory and expiry, prescriptions, billing, staff login and sales reports.",
    tags: ["Java", "React", "PostgreSQL"],
    img: "",
    link: "https://github.com/vanshika701/Pharmacy-Management-System",
    colors: ["#7fb0ff", "#0b1838"],
    details: {
      overview: [
        "A system that streamlines day-to-day pharmacy operations, from tracking stock and expiry dates to handling prescriptions and generating invoices.",
      ],
      sections: [
        {
          title: "Features",
          items: [
            "Inventory: stock levels, expiry dates and prices.",
            "Prescriptions: doctor prescriptions, patient info and medication details.",
            "Billing: invoices, payments and financial records.",
            "Staff authentication and reports on inventory, sales and transactions.",
          ],
        },
      ],
      stack: ["Java 17", "React", "Node.js", "PostgreSQL (Supabase)", "Postman"],
    },
  },
];

const pad = (n) => String(n).padStart(2, "0");

function makeCard(project, i) {
  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = `
    <div class="card-media" style="--img: ${project.img ? `url('${project.img}')` : "none"}; --pos: ${project.imgPos || "center"}; --c1: ${project.colors[0]}; --c2: ${project.colors[1]}">
      <span class="card-num">${pad(i + 1)}</span>
      <span class="card-hint">Read more →</span>
      <span class="card-glyph">${project.glyph}</span>
    </div>
    <div class="card-body">
      <h3>${project.title}</h3>
      <p>${project.desc}</p>
      <ul class="tags">${project.tags.map((t) => `<li>${t}</li>`).join("")}</ul>
      <div class="card-actions">
        <button class="card-details" type="button">Details <span>+</span></button>
        ${project.link !== "#" ? `<a class="card-link" href="${project.link}" target="_blank" rel="noopener">GitHub <span>↗</span></a>` : ""}
      </div>
    </div>`;
  card.querySelector(".card-details").addEventListener("click", (e) => {
    e.stopPropagation();
    openDetails(i);
  });
  // Hide the generated glyph once a real screenshot loads
  if (project.img) {
    const probe = new Image();
    probe.onload = () => card.querySelector(".card-media").classList.add("has-img");
    probe.src = project.img;
  }
  return card;
}

// ---------- The stack ----------
const deck = document.getElementById("deck");
const cards = PROJECTS.map((p, i) => deck.appendChild(makeCard(p, i)));
let order = cards.map((_, i) => i); // order[0] is the card on top
document.getElementById("deck-total").textContent = pad(cards.length);

function layoutDeck() {
  order.forEach((cardIndex, depth) => {
    const card = cards[cardIndex];
    // Cards behind shrink from their top edge and rise, so each one peeks out above the last
    const side = depth % 2 ? 1 : -1;
    const lift = depth * 30;
    const shift = depth === 0 ? 0 : side * depth * 14;
    const tilt = depth === 0 ? 0 : side * depth * 2.5;
    card.style.transform = `translate(${shift}px, ${-lift}px) scale(${1 - depth * 0.06}) rotate(${tilt}deg)`;
    // Cards further back fade into the night instead of sitting as solid blocks
    card.style.opacity = [1, 0.55, 0.32, 0.16][depth] ?? 0;
    card.style.zIndex = cards.length - depth;
  });
  document.getElementById("deck-index").textContent = pad(order[0] + 1);
}

// Move a card instantly (no transition), then let layoutDeck animate from there
function snap(card, transform, opacity) {
  card.classList.add("no-anim");
  card.style.transform = transform;
  card.style.opacity = opacity;
  card.offsetWidth; // flush styles
  card.classList.remove("no-anim");
}

let deckBusy = false;
function nextCard(dir = 1) {
  if (deckBusy) return;
  deckBusy = true;
  const top = cards[order[0]];
  top.style.transform = `translate(${dir * 140}%, -30px) rotate(${dir * 22}deg)`;
  top.style.opacity = 0;
  setTimeout(() => {
    order.push(order.shift());
    snap(top, "translateY(-140px) scale(0.75)", 0); // tuck it in behind the pile
    layoutDeck();
    deckBusy = false;
  }, 380);
}

function prevCard() {
  if (deckBusy) return;
  order.unshift(order.pop());
  snap(cards[order[0]], "translate(-140%, -30px) rotate(-22deg)", 0); // fly in from the left
  layoutDeck();
}

// Drag / swipe the top card
let drag = null;
deck.addEventListener("pointerdown", (e) => {
  const top = cards[order[0]];
  if (deckBusy || !top.contains(e.target) || e.target.closest("a, button")) return;
  drag = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, card: top };
  top.setPointerCapture(e.pointerId);
  top.classList.add("dragging");
});
deck.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.dx = e.clientX - drag.x;
  const dy = (e.clientY - drag.y) * 0.25;
  drag.card.style.transform = `translate(${drag.dx}px, ${dy}px) rotate(${drag.dx * 0.05}deg)`;
});
function endDrag() {
  if (!drag) return;
  const { card, dx, t } = drag;
  const speed = Math.abs(dx) / (performance.now() - t);
  card.classList.remove("dragging");
  drag = null;
  if (Math.abs(dx) < 6) {
    layoutDeck();
    openDetails(order[0]); // a plain click on the card
  } else if (Math.abs(dx) > 100 || (Math.abs(dx) > 30 && speed > 0.6)) nextCard(Math.sign(dx));
  else layoutDeck(); // not far enough: spring back
}
deck.addEventListener("pointerup", endDrag);
deck.addEventListener("pointercancel", endDrag);

document.getElementById("deck-next").addEventListener("click", () => nextCard(1));
document.getElementById("deck-prev").addEventListener("click", prevCard);
deck.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") nextCard(1);
  if (e.key === "ArrowLeft") prevCard();
});
layoutDeck();

// ---------- Gallery ----------
const gallery = document.getElementById("gallery");
const galleryGrid = document.getElementById("gallery-grid");
PROJECTS.forEach((p, i) => {
  const card = makeCard(p, i);
  card.style.setProperty("--d", `${0.08 + i * 0.07}s`);
  card.addEventListener("click", (e) => !e.target.closest("a") && openDetails(i));
  galleryGrid.appendChild(card);
});

function openGallery() {
  gallery.classList.add("open");
  gallery.setAttribute("aria-hidden", "false");
  body.classList.add("gallery-open");
  document.getElementById("close-gallery").focus();
}
function closeGallery() {
  gallery.classList.remove("open");
  gallery.setAttribute("aria-hidden", "true");
  body.classList.remove("gallery-open");
  document.getElementById("open-gallery").focus();
}
document.getElementById("open-gallery").addEventListener("click", openGallery);
document.getElementById("close-gallery").addEventListener("click", closeGallery);
gallery.addEventListener("click", (e) => e.target === gallery && closeGallery());
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (drawer.classList.contains("open")) closeDetails();
  else if (gallery.classList.contains("open")) closeGallery();
});

// ---------- Project details panel ----------
const drawer = document.getElementById("drawer");
const drawerContent = document.getElementById("drawer-content");
let detailsOpener = null;

function openDetails(i) {
  const p = PROJECTS[i];
  const d = p.details || { overview: [p.desc], stack: p.tags };
  const blocks = [
    `<p class="d-num">Project ${pad(i + 1)}</p>`,
    `<h2 id="drawer-title">${p.title}</h2>`,
    `<ul class="tags">${p.tags.map((t) => `<li>${t}</li>`).join("")}</ul>`,
    p.img ? `<figure class="d-media"><img src="${p.img}" alt="${p.title}" onerror="this.parentElement.remove()" /></figure>` : "",
    `<div class="d-overview">${d.overview.map((t) => `<p>${t}</p>`).join("")}</div>`,
  ];
  if (d.metrics) {
    blocks.push(`<div class="d-metrics">${d.metrics
      .map(([v, l]) => `<div><strong>${v}</strong><span>${l}</span></div>`)
      .join("")}</div>`);
  }
  (d.sections || []).forEach((sec) => {
    blocks.push(`<section class="d-section"><h4>${sec.title}</h4><ul>${sec.items
      .map((it) => `<li>${it}</li>`)
      .join("")}</ul></section>`);
  });
  if (!p.details) blocks.push(`<p class="d-soon">Full write-up coming soon.</p>`);
  blocks.push(`<section class="d-section"><h4>Built with</h4><p class="d-stack">${d.stack.join(" / ")}</p></section>`);
  if (p.link !== "#") {
    blocks.push(`<a class="gallery-btn d-cta" href="${p.link}" target="_blank" rel="noopener">View on GitHub <span>↗</span></a>`);
  }
  drawerContent.innerHTML = blocks.filter(Boolean).join("");
  [...drawerContent.children].forEach((el, n) => el.style.setProperty("--i", n));

  detailsOpener = document.activeElement;
  drawer.querySelector(".drawer-panel").scrollTop = 0;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  body.classList.add("drawer-open");
  drawer.querySelector(".drawer-close").focus();
}

function closeDetails() {
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  body.classList.remove("drawer-open");
  detailsOpener?.focus?.();
}
drawer.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeDetails));

// ============================================================
//  Experience timeline: draw the line and light up roles on scroll
// ============================================================

const timeline = document.getElementById("timeline");
const tlItems = [...timeline.querySelectorAll(".tl-item")];

function updateTimeline() {
  const vh = window.innerHeight;
  const r = timeline.getBoundingClientRect();
  // The tip of the line sits a little below the middle of the screen
  const tip = Math.min(Math.max(vh * 0.6 - r.top, 0), r.height);
  timeline.style.setProperty("--p", `${(tip / r.height) * 100}%`);

  tlItems.forEach((item) => {
    const node = item.querySelector(".tl-node");
    const nodeY = node.getBoundingClientRect().top - r.top;
    item.classList.toggle("lit", tip >= nodeY);
    // Year drifts at its own speed for a parallax feel
    const ir = item.getBoundingClientRect();
    const offset = (ir.top + ir.height / 2 - vh / 2) * -0.18;
    item.querySelector(".tl-year").style.transform = `translateY(${offset}px)`;
  });
}
window.addEventListener("scroll", updateTimeline, { passive: true });
window.addEventListener("resize", updateTimeline);
updateTimeline();
