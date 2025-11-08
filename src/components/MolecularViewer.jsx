import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getMoleculePoints, ELEMENTS } from "pubchemtest";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED GLOBALS — ONE-TIME SETUP, PERSISTENT ACROSS NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
let sharedRenderer = null;
let sharedScene = null;
let sharedCamera = null;
let sharedControls = null;
let sharedSprites = [];
let sharedBondLines = [];
let animationId = null;
let cycleInterval = null;
let resizeObserver = null;

const maxPoints = 150;
const ELEMENT_TEXTURES = {
    H: "/chemdemo/images/h.png",
    C: "/chemdemo/images/c.png",
    N: "/chemdemo/images/c.png",
    O: "/chemdemo/images/c.png",
    F: "/chemdemo/images/c.png",
    P: "/chemdemo/images/dot.png",
    S: "/chemdemo/images/dot.png",
    Cl: "/chemdemo/images/dot.png",
    Br: "/chemdemo/images/dot.png",
    I: "/chemdemo/images/dot.png",
    Unknown: "/chemdemo/images/dot.png",
};

let POSITION_SETS = [];
let currentSet = 0;
let progress = 0;
let animating = false;

// ─────────────────────────────────────────────────────────────────────────────
// LOAD MOLECULES ONCE
// ─────────────────────────────────────────────────────────────────────────────
async function loadMoleculesOnce() {
    if (POSITION_SETS.length > 0) return; // already loaded

    const names = ["Ergosterol", "Previtamin D2", "Ergocalciferol"];
    let prev = null;
    for (const name of names) {
        const mol = await getMoleculePoints(name, 0.45, prev);
        POSITION_SETS.push(mol);
        prev = mol;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSITION LOGIC (uses atomMapping)
// ─────────────────────────────────────────────────────────────────────────────
const transition = (idx) => {
    const target = POSITION_SETS[idx];
    const { atoms, bonds, atomMapping } = target;

    sharedSprites.forEach((s, i) => {
        s.userData.start.copy(s.position);
        s.userData.fadeStart = s.material.opacity;

        if (atomMapping && atomMapping[i] !== -1 && atomMapping[i] < atoms.length) {
            s.userData.target.set(...atoms[atomMapping[i]]);
            s.userData.fadeEnd = 1;
        } else if (i < atoms.length) {
            s.userData.target.set(...atoms[i]);
            s.userData.fadeEnd = 1;
        } else {
            s.userData.target.copy(s.position);
            s.userData.fadeEnd = 0;
        }
    });

    sharedBondLines.forEach((line, i) => {
        if (i >= bonds.length) return;
        const b = bonds[i];
        if (b.from < atoms.length && b.to < atoms.length) {
            line.userData.targetStart.set(...atoms[b.from]);
            line.userData.targetEnd.set(...atoms[b.to]);
        }
    });

    progress = 0;
    animating = true;
};

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION LOOP
// ─────────────────────────────────────────────────────────────────────────────
const animate = () => {
    animationId = requestAnimationFrame(animate);

    if (animating) {
        progress = Math.min(progress + 0.02, 1);
        if (progress >= 1) animating = false;

        const t = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;

        sharedSprites.forEach(s => {
            s.position.lerpVectors(s.userData.start, s.userData.target, t);
            s.material.opacity = THREE.MathUtils.lerp(s.userData.fadeStart, s.userData.fadeEnd, t);
        });

        sharedBondLines.forEach(line => {
            const start = new THREE.Vector3().lerpVectors(line.userData.startStart, line.userData.targetStart, t);
            const end = new THREE.Vector3().lerpVectors(line.userData.startEnd, line.userData.targetEnd, t);
            line.geometry.setFromPoints([start, end]);
            //line.geometry.computeBoundingSphere();
        });
    }

    sharedControls.update();
    sharedRenderer.render(sharedScene, sharedCamera);
};

// ─────────────────────────────────────────────────────────────────────────────
// REACT COMPONENT — MOUNT ONLY
// ─────────────────────────────────────────────────────────────────────────────
const PointCloudBillboard = () => {
    const mountRef = useRef(null);

    useEffect(() => {
        if (!mountRef.current) return;

        const init = async () => {
            // 1. Load data once
            await loadMoleculesOnce();

            // 2. One-time THREE setup
            if (!sharedRenderer) {
                sharedScene = new THREE.Scene();
                sharedCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
                sharedCamera.position.z = 2;

                sharedRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
                sharedRenderer.setClearColor(0x000000, 0);
                sharedRenderer.setPixelRatio(1);

                sharedControls = new OrbitControls(sharedCamera, sharedRenderer.domElement);
                sharedControls.enableDamping = true;
                sharedControls.dampingFactor = 0.05;
                sharedControls.enableZoom = false;
                sharedControls.enablePan = false;

                // Textures
                const loader = new THREE.TextureLoader();
                const textures = ELEMENTS.map(el => loader.load(ELEMENT_TEXTURES[el] || ELEMENT_TEXTURES.Unknown));

                // Sprites
                const first = POSITION_SETS[0];
                for (let i = 0; i < maxPoints; i++) {
                    const elIdx = first.elementIndexes[i] ?? ELEMENTS.length - 1;
                    const mat = new THREE.SpriteMaterial({ map: textures[elIdx], transparent: true, opacity: 0 });
                    const sprite = new THREE.Sprite(mat);
                    sprite.scale.setScalar(0.1);
                    const pos = first.atoms[i] || [0, 0, 0];
                    sprite.position.set(...pos);
                    sprite.userData = {
                        start: new THREE.Vector3(...pos),
                        target: new THREE.Vector3(...pos),
                        fadeStart: 0,
                        fadeEnd: 1,
                    };
                    sharedScene.add(sprite);
                    sharedSprites.push(sprite);
                }

                // Bonds
                first.bonds.forEach(b => {
                    if (b.from >= first.atoms.length || b.to >= first.atoms.length) return;
                    const start = new THREE.Vector3(...first.atoms[b.from]);
                    const end = new THREE.Vector3(...first.atoms[b.to]);
                    const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
                    const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0xffffff }));
                    line.userData = {
                        startStart: start.clone(),
                        startEnd: end.clone(),
                        targetStart: start.clone(),
                        targetEnd: end.clone(),
                    };
                    sharedScene.add(line);
                    sharedBondLines.push(line);
                });

                // Auto-cycle
                cycleInterval = setInterval(() => {
                    currentSet = (currentSet + 1) % POSITION_SETS.length;
                    transition(currentSet);
                }, 3000);

                animate();
            }

            // 3. Mount renderer (only if not already there)
            if (!mountRef.current.contains(sharedRenderer.domElement)) {
                mountRef.current.appendChild(sharedRenderer.domElement);
            }

            // 4. Resize handler
            const resize = () => {
                const { clientWidth, clientHeight } = mountRef.current;
                sharedCamera.aspect = clientWidth / clientHeight;
                sharedCamera.updateProjectionMatrix();
                sharedRenderer.setSize(clientWidth, clientHeight);
            };
            resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(mountRef.current);
            resize();

            // 5. Start first transition
            transition(0);
        };

        init();

        // ─── CLEANUP: Only remove DOM, never destroy THREE objects ───
        return () => {
            if (mountRef.current && sharedRenderer?.domElement && mountRef.current.contains(sharedRenderer.domElement)) {
                mountRef.current.removeChild(sharedRenderer.domElement);
            }
            resizeObserver?.disconnect();
        };
    }, []);

    return (
        <div
            ref={mountRef}
            style={{
                width: "100%",
                height: "50vw",
                maxHeight: "50vh",
                overflow: "hidden",
                pointerEvents: "all",
                zIndex: 50,
            }}
        />
    );
};

export default PointCloudBillboard;