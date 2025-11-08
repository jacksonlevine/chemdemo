// PointCloudBillboard.jsx
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ELEMENTS, getMoleculePoints } from "pubchemtest";

// ─────────────────────────────────────────────────────────────────────────────
const ATOM_SCALE = 0.3;

const ATOM_RADII = {
    H: 0.12 * ATOM_SCALE,
    C: 0.17 * ATOM_SCALE,
    N: 0.155 * ATOM_SCALE,
    O: 0.152 * ATOM_SCALE,
    F: 0.147 * ATOM_SCALE,
    P: 0.18 * ATOM_SCALE,
    S: 0.18 * ATOM_SCALE,
    Cl: 0.175 * ATOM_SCALE,
    Br: 0.185 * ATOM_SCALE,
    I: 0.198 * ATOM_SCALE,
    Unknown: 0.15 * ATOM_SCALE,
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED GLOBALS
let sharedRenderer = null;
let sharedScene = null;
let sharedCamera = null;
let sharedControls = null;
let sharedAtomMeshes = {};
let sharedBondMesh = null;
let animationId = null;
let cycleInterval = null;
let resizeObserver = null;

const maxPoints = 150;
const maxBonds = 500;

const ELEMENT_COLORS = {
    H: 0xffffff, C: 0xaaaaaa, N: 0x3050f8, O: 0xff0d0d, F: 0x90e050,
    P: 0xff8000, S: 0xffff30, Cl: 0x1ff01f, Br: 0xa6291a, I: 0x940094,
    Unknown: 0x888888,
};

let POSITION_SETS = [];
let currentSet = 0;
let progress = 0;
let animating = false;

const atomStart = {};
const atomTarget = {};

// ─────────────────────────────────────────────────────────────────────────────
// LOAD MOLECULES
async function loadMoleculesOnce(compoundsToLoad) {
    if (POSITION_SETS.length > 0) return;
    let prev = null;
    for (const name of compoundsToLoad) {
        const mol = await getMoleculePoints(name, 0.45, prev);
        POSITION_SETS.push(mol);
        prev = mol;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSITION
const transition = (idx) => {
    const target = POSITION_SETS[idx];
    const { atoms, bonds, atomMapping, elementIndexes } = target;

    // Save current positions
    Object.keys(sharedAtomMeshes).forEach(el => {
        const mesh = sharedAtomMeshes[el];
        for (let i = 0; i < mesh.count; i++) {
            const mat = new THREE.Matrix4();
            mesh.getMatrixAt(i, mat);
            const pos = new THREE.Vector3();
            mat.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
            atomStart[el][i] = pos.clone();
        }
    });

    // Set target atoms
    const dummy = new THREE.Object3D();
    Object.keys(sharedAtomMeshes).forEach(el => {
        const mesh = sharedAtomMeshes[el];
        const elIdx = ELEMENTS.indexOf(el);
        let instanceId = 0;

        for (let i = 0; i < maxPoints; i++) {
            const mapped = (atomMapping && atomMapping[i] !== -1) ? atomMapping[i] : i;
            if (mapped < atoms.length && elementIndexes[mapped] === elIdx) {
                const pos = new THREE.Vector3(...atoms[mapped]);
                const radius = ATOM_RADII[el];
                atomTarget[el][instanceId] = pos;

                dummy.position.copy(pos);
                dummy.scale.setScalar(radius);
                dummy.updateMatrix();
                mesh.setMatrixAt(instanceId, dummy.matrix);

                // UPDATE COLOR IN BUFFER
                const color = new THREE.Color(ELEMENT_COLORS[el]);
                const offset = instanceId * 3;
                mesh.instanceColor.array[offset]     = color.r;
                mesh.instanceColor.array[offset + 1] = color.g;
                mesh.instanceColor.array[offset + 2] = color.b;

                instanceId++;
            }
        }
        mesh.count = instanceId;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
    });

    // BONDS — UNCHANGED
    const bondCount = bonds.length;
    sharedBondMesh.count = bondCount;

    for (let i = 0; i < maxBonds; i++) {
        if (i >= bondCount) {
            dummy.scale.setScalar(0.001);
            dummy.updateMatrix();
            sharedBondMesh.setMatrixAt(i, dummy.matrix);
            continue;
        }

        const b = bonds[i];
        const a1 = atoms[b.from];
        const a2 = atoms[b.to];
        const el1 = ELEMENTS[elementIndexes[b.from]] || "Unknown";
        const el2 = ELEMENTS[elementIndexes[b.to]] || "Unknown";
        const r1 = ATOM_RADII[el1];
        const r2 = ATOM_RADII[el2];

        const start = new THREE.Vector3(...a1);
        const end = new THREE.Vector3(...a2);
        const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);
        const fullLength = start.distanceTo(end);
        const bondLength = Math.max(fullLength - r1 - r2, 0.01);

        const dir = new THREE.Vector3().subVectors(end, start).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            dir
        );

        dummy.position.copy(mid);
        dummy.scale.set(1, bondLength+0.1, 1);
        dummy.quaternion.copy(quat);
        dummy.updateMatrix();
        sharedBondMesh.setMatrixAt(i, dummy.matrix);
    }
    sharedBondMesh.instanceMatrix.needsUpdate = true;

    progress = 0;
    animating = true;
    currentSet = idx;
};

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION LOOP
const animate = () => {
    animationId = requestAnimationFrame(animate);

    if (animating) {
        progress = Math.min(progress + 0.02, 1);
        const t = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;

        const dummy = new THREE.Object3D();

        // ATOMS — INTERPOLATE + FADE
        Object.keys(sharedAtomMeshes).forEach(el => {
            const mesh = sharedAtomMeshes[el];
            const baseColor = new THREE.Color(ELEMENT_COLORS[el]);

            for (let i = 0; i < mesh.count; i++) {
                const start = atomStart[el][i] || new THREE.Vector3();
                const target = atomTarget[el][i] || start;
                const pos = start.lerp(target, t);

                const radius = ATOM_RADII[el];
                dummy.position.copy(pos);
                dummy.scale.setScalar(radius);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);

                // FADE BY MODIFYING COLOR BUFFER
                const offset = i * 3;
                mesh.instanceColor.array[offset]     = baseColor.r;
                mesh.instanceColor.array[offset + 1] = baseColor.g;
                mesh.instanceColor.array[offset + 2] = baseColor.b;
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor.needsUpdate = true;
        });

        // BONDS — INTERPOLATE
        const prev = POSITION_SETS[(currentSet + POSITION_SETS.length - 1) % POSITION_SETS.length];
        const curr = POSITION_SETS[currentSet];

        for (let i = 0; i < Math.max(prev.bonds.length, curr.bonds.length); i++) {
            const b1 = prev.bonds[i] || { from: 0, to: 0 };
            const b2 = curr.bonds[i] || { from: 0, to: 0 };

            const s1 = new THREE.Vector3(...prev.atoms[b1.from]);
            const e1 = new THREE.Vector3(...prev.atoms[b1.to]);
            const s2 = new THREE.Vector3(...curr.atoms[b2.from]);
            const e2 = new THREE.Vector3(...curr.atoms[b2.to]);

            const start = s1.lerp(s2, t);
            const end = e1.lerp(e2, t);
            const fullLength = start.distanceTo(end);

            if (fullLength < 0.01) {
                dummy.scale.setScalar(0.001);
                dummy.updateMatrix();
                sharedBondMesh.setMatrixAt(i, dummy.matrix);
                continue;
            }

            const el1 = ELEMENTS[curr.elementIndexes[b2.from]] || "Unknown";
            const el2 = ELEMENTS[curr.elementIndexes[b2.to]] || "Unknown";
            const r1 = ATOM_RADII[el1];
            const r2 = ATOM_RADII[el2];
            const bondLength = Math.max(fullLength - r1 - r2, 0.01);
            const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);

            const dir = new THREE.Vector3().subVectors(end, start).normalize();
            const quat = new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                dir
            );

            dummy.position.copy(mid);
            dummy.scale.set(1, bondLength+0.1, 1);
            dummy.quaternion.copy(quat);
            dummy.updateMatrix();
            sharedBondMesh.setMatrixAt(i, dummy.matrix);
        }
        sharedBondMesh.count = curr.bonds.length;
        sharedBondMesh.instanceMatrix.needsUpdate = true;

        if (progress >= 1) animating = false;
    }

    sharedControls.update();
    sharedRenderer.render(sharedScene, sharedCamera);
};

// ─────────────────────────────────────────────────────────────────────────────
// REACT COMPONENT
const PointCloudBillboard = () => {
    const mountRef = useRef(null);

    useEffect(() => {
        if (!mountRef.current) return;

        const init = async () => {
            const params = new URLSearchParams(window.location.search);
            const compoundsToLoad = params.get("compounds")?.split(";").map(c => c.trim()).filter(Boolean) ||
                [];

            await loadMoleculesOnce(compoundsToLoad);
            if (POSITION_SETS.length === 0) return;

            if (!sharedRenderer) {
                sharedScene = new THREE.Scene();
                sharedCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
                sharedCamera.position.set(0, 0, 5);

                sharedRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
                sharedRenderer.setClearColor(0x000000, 0);
                sharedRenderer.setPixelRatio(window.devicePixelRatio);

                sharedControls = new OrbitControls(sharedCamera, sharedRenderer.domElement);
                sharedControls.enableDamping = true;
                sharedControls.enableZoom = false;

                sharedControls.minDistance = 2.5;
                sharedControls.maxDistance = 2.5;  
                
                sharedScene.add(new THREE.AmbientLight(0xffffff, 0.6));
                const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
                dirLight.position.set(5, 10, 7);
                sharedScene.add(dirLight);

                const first = POSITION_SETS[0];

                // SPHERE GEOMETRY
                const sphereGeo = new THREE.SphereGeometry(1, 24, 16);

                // COUNT ELEMENTS
                const elementCounts = {};
                first.elementIndexes.forEach(idx => {
                    const el = ELEMENTS[idx] || "Unknown";
                    elementCounts[el] = (elementCounts[el] || 0) + 1;
                });

                // INSTANCED MESH — MESHSTANDARD + MANUAL instanceColor
                Object.entries(elementCounts).forEach(([el, atomCount]) => {
                    const material = new THREE.MeshStandardMaterial({
                        metalness: 0.4,
                        roughness: 0.2,
                    });

                    // COLOR BUFFER
                    const colorArray = new Float32Array(atomCount * 3);
                    const baseColor = new THREE.Color(ELEMENT_COLORS[el]);
                    for (let i = 0; i < atomCount; i++) {
                        colorArray[i * 3]     = baseColor.r;
                        colorArray[i * 3 + 1] = baseColor.g;
                        colorArray[i * 3 + 2] = baseColor.b;
                    }

                    const mesh = new THREE.InstancedMesh(sphereGeo, material, atomCount);
                    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                    mesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
                    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

                    sharedScene.add(mesh);
                    sharedAtomMeshes[el] = mesh;

                    atomStart[el] = [];
                    atomTarget[el] = [];
                });

                // BOND MESH
                const cylGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 16, 1);
                cylGeo.translate(0, 0, 0);

                const bondMat = new THREE.MeshStandardMaterial({
                    color: 0xcccccc,
                    metalness: 0.5,
                    roughness: 0.3
                });
                sharedBondMesh = new THREE.InstancedMesh(cylGeo, bondMat, maxBonds);
                sharedBondMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                sharedScene.add(sharedBondMesh);

                // INITIAL ATOMS
                const dummy = new THREE.Object3D();
                first.atoms.forEach((pos, i) => {
                    const el = ELEMENTS[first.elementIndexes[i]] || "Unknown";
                    const mesh = sharedAtomMeshes[el];
                    if (!mesh) return;

                    const radius = ATOM_RADII[el];
                    const instanceId = mesh.count;
                    dummy.position.set(...pos);
                    dummy.scale.setScalar(radius);
                    dummy.updateMatrix();
                    mesh.setMatrixAt(instanceId, dummy.matrix);
                    mesh.count++;

                    atomStart[el][instanceId] = new THREE.Vector3(...pos);
                });
                Object.values(sharedAtomMeshes).forEach(m => {
                    m.instanceMatrix.needsUpdate = true;
                    m.instanceColor.needsUpdate = true;
                });

                // INITIAL BONDS
                first.bonds.forEach((b, i) => {
                    const a1 = first.atoms[b.from];
                    const a2 = first.atoms[b.to];
                    const el1 = ELEMENTS[first.elementIndexes[b.from]] || "Unknown";
                    const el2 = ELEMENTS[first.elementIndexes[b.to]] || "Unknown";
                    const r1 = ATOM_RADII[el1];
                    const r2 = ATOM_RADII[el2];

                    const start = new THREE.Vector3(...a1);
                    const end = new THREE.Vector3(...a2);
                    const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);
                    const fullLength = start.distanceTo(end);
                    const bondLength = Math.max(fullLength - r1 - r2, 0.01);

                    const dir = new THREE.Vector3().subVectors(end, start).normalize();
                    const quat = new THREE.Quaternion().setFromUnitVectors(
                        new THREE.Vector3(0, 1, 0),
                        dir
                    );

                    dummy.position.copy(mid);
                    dummy.scale.set(1, bondLength+0.1, 1);
                    dummy.quaternion.copy(quat);
                    dummy.updateMatrix();
                    sharedBondMesh.setMatrixAt(i, dummy.matrix);
                });
                sharedBondMesh.count = first.bonds.length;
                sharedBondMesh.instanceMatrix.needsUpdate = true;

                cycleInterval = setInterval(() => {
                    currentSet = (currentSet + 1) % POSITION_SETS.length;
                    transition(currentSet);
                }, 3000);

                animate();
            }

            if (!mountRef.current.contains(sharedRenderer.domElement)) {
                mountRef.current.appendChild(sharedRenderer.domElement);
            }

            const resize = () => {
                const { clientWidth, clientHeight } = mountRef.current;
                sharedCamera.aspect = clientWidth / clientHeight;
                sharedCamera.updateProjectionMatrix();
                sharedRenderer.setSize(clientWidth, clientHeight);
            };
            resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(mountRef.current);
            resize();

            transition(0);
        };

        init();

        return () => {
            if (mountRef.current?.contains(sharedRenderer?.domElement)) {
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