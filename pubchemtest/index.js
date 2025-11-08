import { Compound } from 'pubchem';

/**
 * Global element array (common elements + "unknown")
 */
export const ELEMENTS = [
    "H","C","N","O","F","P","S","Cl","Br","I","Unknown"
];

/**
 * Compute adjacency lists for a molecule
 */
function adjacency(bonds, n) {
    const adj = Array.from({ length: n }, () => new Set());
    bonds.forEach(b => {
        adj[b.from].add(b.to);
        adj[b.to].add(b.from);
    });
    return adj;
}

/**
 * Basic Maximum Common Substructure (MCS) atom mapping
 */
function computeAtomMapping(molA, molB) {
    const nA = molA.atoms.length;
    const nB = molB.atoms.length;
    const adjA = adjacency(molA.bonds, nA);
    const adjB = adjacency(molB.bonds, nB);

    const mapping = Array(nA).fill(-1);
    const usedB = Array(nB).fill(false);

    for (let i = 0; i < nA; i++) {
        let bestJ = -1;
        let bestScore = -1;
        for (let j = 0; j < nB; j++) {
            if (usedB[j]) continue;
            if (molA.elementIndexes[i] !== molB.elementIndexes[j]) continue;

            // score = # of common neighbors already mapped
            let score = 0;
            for (let nei of adjA[i]) {
                if (nei < i && mapping[nei] !== -1 && adjB[j].has(mapping[nei])) {
                    score++;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestJ = j;
            }
        }
        if (bestJ !== -1) {
            mapping[i] = bestJ;
            usedB[bestJ] = true;
        }
    }
    return mapping;
}

/**
 * Compute centroid of a list of points
 */
function centroid(points) {
    const n = points.length;
    const sum = [0, 0, 0];
    for (const p of points) {
        sum[0] += p[0];
        sum[1] += p[1];
        sum[2] += p[2];
    }
    return sum.map(s => s / n);
}

/**
 * Compute optimal rotation using Kabsch algorithm (via SVD)
 */
function computeAlignment(pointsA, pointsB) {
    const n = pointsA.length;
    if (n === 0) return { R: [[1,0,0],[0,1,0],[0,0,1]], t: [0,0,0] };

    const cA = centroid(pointsA);
    const cB = centroid(pointsB);

    const A = pointsA.map(p => [p[0]-cA[0], p[1]-cA[1], p[2]-cA[2]]);
    const B = pointsB.map(p => [p[0]-cB[0], p[1]-cB[1], p[2]-cB[2]]);

    // Covariance matrix H = A^T * B
    const H = Array.from({ length: 3 }, () => [0,0,0]);
    for (let i = 0; i < n; i++) {
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                H[r][c] += A[i][r] * B[i][c];
            }
        }
    }

    // SVD of H
    const { U, S, Vt } = svd3x3(H);

    // Rotation R = V * U^T
    let R = multiplyMatrices(Vt, transpose(U));

    // Handle reflection case
    const det =
        R[0][0]*(R[1][1]*R[2][2]-R[1][2]*R[2][1]) -
        R[0][1]*(R[1][0]*R[2][2]-R[1][2]*R[2][0]) +
        R[0][2]*(R[1][0]*R[2][1]-R[1][1]*R[2][0]);
    if (det < 0) {
        Vt[2] = Vt[2].map(v => -v);
        R = multiplyMatrices(Vt, transpose(U));
    }

    // Translation t = cB - R * cA
    const RcA = multiplyMatrixVec(R, cA);
    const t = [cB[0]-RcA[0], cB[1]-RcA[1], cB[2]-RcA[2]];

    return { R, t };
}

/**
 * Lightweight 3×3 SVD via numeric.js-style Jacobi iteration
 */
function svd3x3(M) {
    // Very small, approximate SVD for 3x3 real matrix
    // Using simple numeric approach sufficient for visualization
    // For real use, swap for proper lib like `svd-js` if desired

    // Compute M^T * M
    const MtM = multiplyMatrices(transpose(M), M);

    // Eigen-decompose MtM to get V
    const { eigenvectors: V, eigenvalues: Svals } = eigenSymmetric(MtM);

    // Sort descending
    const order = [0,1,2].sort((a,b) => Svals[b]-Svals[a]);
    const S = order.map(i => Math.sqrt(Svals[i]));
    const Vt = order.map(i => V[i]);

    // Compute U = M * V * S^-1
    const VinvS = Vt.map((v,i) => v.map(x => x / (S[i] || 1e-12)));
    const U = multiplyMatrices(M, transpose(VinvS));

    return { U, S, Vt };
}

/**
 * Eigen-decomposition for 3x3 symmetric matrix (very rough)
 */
function eigenSymmetric(M) {
    // Simple power iteration approach for 3 eigenpairs
    // Not numerically perfect but adequate for alignment visuals
    const clone = m => M.map(r => [...r]);
    let A = clone(M);
    const eigenvalues = [];
    const eigenvectors = [];

    for (let k = 0; k < 3; k++) {
        let v = [Math.random(), Math.random(), Math.random()];
        for (let i = 0; i < 15; i++) {
            v = multiplyMatrixVec(A, v);
            const norm = Math.hypot(...v);
            v = v.map(x => x / norm);
        }
        const Av = multiplyMatrixVec(A, v);
        const λ = dot(v, Av);
        eigenvalues.push(λ);
        eigenvectors.push(v);
        // Deflate
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++)
                A[i][j] -= λ * v[i] * v[j];
    }
    return { eigenvectors, eigenvalues };
}

function multiplyMatrices(A, B) {
    const res = Array.from({ length: A.length }, () => Array(B[0].length).fill(0));
    for (let i = 0; i < A.length; i++)
        for (let j = 0; j < B[0].length; j++)
            for (let k = 0; k < B.length; k++)
                res[i][j] += A[i][k] * B[k][j];
    return res;
}

function transpose(A) {
    return A[0].map((_, c) => A.map(r => r[c]));
}

function multiplyMatrixVec(M, v) {
    return [M[0][0]*v[0]+M[0][1]*v[1]+M[0][2]*v[2],
        M[1][0]*v[0]+M[1][1]*v[1]+M[1][2]*v[2],
        M[2][0]*v[0]+M[2][1]*v[1]+M[2][2]*v[2]];
}

function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

/**
 * Main molecule fetch + alignment
 */
export async function getMoleculePoints(name, inferredTolerance = 0.45, previousMol = null) {
    const compound = await Compound.fromName(name);
    const cid = compound.getCID();
    console.log(`CID for ${name}: ${cid}`);

    const sdfUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d`;
    const res = await fetch(sdfUrl);
    if (!res.ok) throw new Error(`Unable to download SDF for CID ${cid}`);
    const sdf = await res.text();

    const lines = sdf.split('\n');
    if (lines.length < 4) throw new Error('SDF too short');
    const countLine = lines[3].trim().split(/\s+/);
    const atomCount = parseInt(countLine[0], 10);
    const bondCount = parseInt(countLine[1], 10);

    const atomLines = lines.slice(4, 4 + atomCount);
    const bondLines = lines.slice(4 + atomCount, 4 + atomCount + bondCount);

    const atomsRaw = atomLines.map(line => ({
        element: line.substr(31, 3).trim(),
        x: parseFloat(line.substr(0, 10)),
        y: parseFloat(line.substr(10, 10)),
        z: parseFloat(line.substr(20, 10))
    })).filter(a => !isNaN(a.x) && !isNaN(a.y) && !isNaN(a.z));

    if (atomsRaw.length === 0) throw new Error('Parsed zero atoms');

    let bonds = bondLines.map(line => {
        const from = parseInt(line.substr(0, 3), 10) - 1;
        const to = parseInt(line.substr(3, 3), 10) - 1;
        const type = parseInt(line.substr(6, 3), 10);
        return { from, to, type };
    });

    let atoms = atomsRaw.map(a => [a.x, a.y, a.z]);
    const elementIndexes = atomsRaw.map(a =>
        ELEMENTS.indexOf(a.element) >= 0 ? ELEMENTS.indexOf(a.element) : ELEMENTS.length - 1
    );

    let atomMapping = null;
    if (previousMol) {
        atomMapping = computeAtomMapping({ atoms, elementIndexes, bonds }, previousMol);

        // Filter matched points for alignment
        const pairs = atomMapping
            .map((j, i) => (j !== -1 ? [atoms[i], previousMol.atoms[j]] : null))
            .filter(Boolean);

        if (pairs.length >= 3) {
            const newPoints = pairs.map(p => p[0]);
            const oldPoints = pairs.map(p => p[1]);
            const { R, t } = computeAlignment(newPoints, oldPoints);

            // Apply transformation to all atoms
            for (let i = 0; i < atoms.length; i++) {
                const rotated = multiplyMatrixVec(R, atoms[i]);
                atoms[i] = [rotated[0] + t[0], rotated[1] + t[1], rotated[2] + t[2]];
            }
        }
    }

    // Normalize and center
    const xs = atoms.map(a => a[0]), ys = atoms.map(a => a[1]), zs = atoms.map(a => a[2]);
    const min = { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) };
    const max = { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) };

    const center = [
        (min.x + max.x) / 2,
        (min.y + max.y) / 2,
        (min.z + max.z) / 2
    ];
    const size = [
        max.x - min.x,
        max.y - min.y,
        max.z - min.z
    ];

// Determine if we need to scale down
    const maxDim = Math.max(size[0], size[1], size[2]);
    const scale = maxDim > 1.0 ? 1.0 / maxDim : 1.0;

// Center and (if needed) scale
    atoms = atoms.map(a => [
        (a[0] - center[0]) * scale,
        (a[1] - center[1]) * scale,
        (a[2] - center[2]) * scale
    ]);

    return { atoms, elementIndexes, bonds, atomMapping };
}
