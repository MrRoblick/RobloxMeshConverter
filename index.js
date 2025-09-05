const fs = require('fs');
const path = require('path');

function align4(n){ return (n + 3) & ~3; }

class RobloxMesh {
    constructor(){
        this.vertices = []; // each: {vx,vy,vz,nx,ny,nz,tu,tv,tw}
        this.faces = [];    // each: {a,b,c} uint32
    }

    static fromMeshFile(buf) {
        // try ASCII first line to detect version
        const newlineIdx = buf.indexOf(0x0A); // '\n'
        let firstLine = "";
        if (newlineIdx !== -1) {
            firstLine = buf.slice(0, newlineIdx).toString('utf8').trim();
        } else {
            firstLine = buf.toString('utf8', 0, Math.min(buf.length, 32)).trim();
        }

        const mesh = new RobloxMesh();

        if (firstLine.startsWith("version ")) {
            const ver = firstLine.substr(8).trim();
            if (ver === "2.00") {
                // binary style: after newline there is a 12-byte header:
                // uint16 headerSize; uint8 vertexSize; uint8 faceSize; uint32 vertexCount; uint32 faceCount;
                const headerPos = buf.indexOf(0x0A) + 1; // after newline
                if (headerPos <= 0) throw new Error("Invalid mesh (no newline before header)");
                if (headerPos + 12 > buf.length) throw new Error("Truncated mesh header");
                const headerBuf = buf.slice(headerPos, headerPos + 12);
                const headerSize = headerBuf.readUInt16LE(0);
                const vertexSize = headerBuf.readUInt8(2);
                const faceSize = headerBuf.readUInt8(3);
                const vertexCount = headerBuf.readUInt32LE(4);
                const faceCount = headerBuf.readUInt32LE(8);

                const vertsStart = headerPos + 12;
                let offset = vertsStart;
                mesh.vertices = [];
                // expect float32 * 9 per vertex
                for (let i = 0; i < vertexCount; ++i) {
                    const v = {};
                    v.vx = buf.readFloatLE(offset); offset += 4;
                    v.vy = buf.readFloatLE(offset); offset += 4;
                    v.vz = buf.readFloatLE(offset); offset += 4;
                    v.nx = buf.readFloatLE(offset); offset += 4;
                    v.ny = buf.readFloatLE(offset); offset += 4;
                    v.nz = buf.readFloatLE(offset); offset += 4;
                    v.tu = buf.readFloatLE(offset); offset += 4;
                    v.tv = buf.readFloatLE(offset); offset += 4;
                    v.tw = buf.readFloatLE(offset); offset += 4;
                    // if vertexSize != 36, try to skip the remainder
                    if (vertexSize > 36) offset += (vertexSize - 36);
                    mesh.vertices.push(v);
                }

                mesh.faces = [];
                for (let i = 0; i < faceCount; ++i) {
                    const a = buf.readUInt32LE(offset); offset += 4;
                    const b = buf.readUInt32LE(offset); offset += 4;
                    const c = buf.readUInt32LE(offset); offset += 4;
                    if (faceSize > 12) offset += (faceSize - 12);
                    mesh.faces.push({a,b,c});
                }
                return {mesh, version: "2.00"};
            } else if (ver === "1.00" || ver === "1.01") {
                // ASCII parsing best-effort (similar to C++ best-effort)
                const rest = buf.toString('utf8', newlineIdx + 1);
                // first line after version is face count
                const lines = rest.split(/\r?\n/);
                const facesCountLine = lines[0] ? lines[0].trim() : "0";
                const faceCount = parseInt(facesCountLine) || 0;
                const body = rest.substr(rest.indexOf('\n') + 1);
                const regex = /\[([^\]]+)\]\s*\[([^\]]+)\]\s*\[([^\]]+)\]/g;
                let m;
                mesh.vertices = [];
                while ((m = regex.exec(body)) !== null) {
                    // m[1] = "x,y,z" ; m[2] = "nx,ny,nz"; m[3] = "tu,tv,0"
                    const a1 = m[1].split(',').map(s=>parseFloat(s.trim())||0);
                    const a2 = m[2].split(',').map(s=>parseFloat(s.trim())||0);
                    const a3 = m[3].split(',').map(s=>parseFloat(s.trim())||0);
                    mesh.vertices.push({
                        vx: a1[0]||0, vy: a1[1]||0, vz: a1[2]||0,
                        nx: a2[0]||0, ny: a2[1]||0, nz: a2[2]||0,
                        tu: a3[0]||0, tv: a3[1]||0, tw: a3[2]||0
                    });
                }
                // create sequential faces if faceCount > 0
                mesh.faces = [];
                if (faceCount > 0) {
                    let idx = 0;
                    for (let i = 0; i < faceCount; ++i) {
                        if (idx + 2 >= mesh.vertices.length) break;
                        mesh.faces.push({a: idx, b: idx+1, c: idx+2});
                        idx += 3;
                    }
                }
                return {mesh, version: ver};
            } else {
                throw new Error("Unsupported mesh version: " + ver);
            }
        } else {
            throw new Error("Unknown mesh format (missing 'version')");
        }
    }

    static toMeshBuffer(mesh) {
        // write "version 2.00\n" + header (12 bytes) + vertices + faces
        const headerSize = 12;
        const vertexSize = 9 * 4; // 9 floats = 36
        const faceSize = 3 * 4;    // 3 uint32 = 12

        const vertBuf = Buffer.alloc(mesh.vertices.length * vertexSize);
        let off = 0;
        for (let v of mesh.vertices) {
            vertBuf.writeFloatLE(v.vx || 0, off); off += 4;
            vertBuf.writeFloatLE(v.vy || 0, off); off += 4;
            vertBuf.writeFloatLE(v.vz || 0, off); off += 4;
            vertBuf.writeFloatLE(v.nx || 0, off); off += 4;
            vertBuf.writeFloatLE(v.ny || 0, off); off += 4;
            vertBuf.writeFloatLE(v.nz || 0, off); off += 4;
            vertBuf.writeFloatLE(v.tu || 0, off); off += 4;
            vertBuf.writeFloatLE(v.tv || 0, off); off += 4;
            vertBuf.writeFloatLE(v.tw || 0, off); off += 4;
        }

        const facesBuf = Buffer.alloc(mesh.faces.length * faceSize);
        off = 0;
        for (let f of mesh.faces) {
            facesBuf.writeUInt32LE(f.a >>> 0, off); off += 4;
            facesBuf.writeUInt32LE(f.b >>> 0, off); off += 4;
            facesBuf.writeUInt32LE(f.c >>> 0, off); off += 4;
        }

        const headerBuf = Buffer.alloc(12);
        headerBuf.writeUInt16LE(headerSize, 0);
        headerBuf.writeUInt8(vertexSize, 2);
        headerBuf.writeUInt8(faceSize, 3);
        headerBuf.writeUInt32LE(mesh.vertices.length, 4);
        headerBuf.writeUInt32LE(mesh.faces.length, 8);

        const out = Buffer.concat([Buffer.from("version 2.00\n", 'utf8'), headerBuf, vertBuf, facesBuf]);
        return out;
    }
}

// --- GLB read/write minimal implementation ---

function readGLB(filePath) {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 12) throw new Error("Not a GLB (too short)");
    const magic = buf.toString('ascii', 0, 4);
    const version = buf.readUInt32LE(4);
    const length = buf.readUInt32LE(8);
    if (magic !== "glTF" || version !== 2) throw new Error("Not a GLB v2 file");

    let offset = 12;
    // read chunks
    // chunk0 = JSON
    const jsonChunkLength = buf.readUInt32LE(offset); offset += 4;
    const jsonChunkType = buf.toString('ascii', offset, offset+4); offset += 4;
    if (jsonChunkType !== 'JSON') throw new Error("First chunk is not JSON");
    const jsonText = buf.slice(offset, offset + jsonChunkLength).toString('utf8'); offset += align4(jsonChunkLength);

    const json = JSON.parse(jsonText);

    // optional BIN chunk
    let binChunk = null;
    if (offset + 8 <= buf.length) {
        const binChunkLength = buf.readUInt32LE(offset); 
        const binChunkType = buf.toString('ascii', offset + 4, offset + 8);
        offset += 8;
        if (binChunkType === 'BIN\0' || binChunkType === 'BIN\0'.replace('\0','\0')) {
            binChunk = buf.slice(offset, offset + binChunkLength);
            // offset += align4(binChunkLength);
        } else {
            // no BIN chunk
            binChunk = null;
        }
    }

    return {json, binChunk};
}

function accessorReadFloatArray(json, bin, accessorIdx) {
    const acc = json.accessors[accessorIdx];
    const bv = json.bufferViews[acc.bufferView];
    const buffer = bin;
    const bvByteOffset = bv.byteOffset || 0;
    const accByteOffset = acc.byteOffset || 0;
    const byteOffset = bvByteOffset + accByteOffset;
    const count = acc.count;
    const numComp = {
        "SCALAR":1,"VEC2":2,"VEC3":3,"VEC4":4
    }[acc.type] || 1;

    const compType = acc.componentType; // expect FLOAT (5126)
    const out = new Array(count * numComp);
    if (compType !== 5126) {
        throw new Error("Accessor componentType is not FLOAT as expected");
    }
    let off = byteOffset;
    for (let i=0;i<count;i++){
        for (let c=0;c<numComp;c++){
            out[i*numComp + c] = buffer.readFloatLE(off);
            off += 4;
        }
    }
    return {data: out, count, numComp};
}

function accessorReadIndices(json, bin, accessorIdx) {
    const acc = json.accessors[accessorIdx];
    const bv = json.bufferViews[acc.bufferView];
    const buffer = bin;
    const bvByteOffset = bv.byteOffset || 0;
    const accByteOffset = acc.byteOffset || 0;
    const byteOffset = bvByteOffset + accByteOffset;
    const count = acc.count;
    const compType = acc.componentType;
    const out = new Array(count);
    let off = byteOffset;
    if (compType === 5123) { // UNSIGNED_SHORT
        for (let i=0;i<count;i++){
            out[i] = buffer.readUInt16LE(off); off += 2;
        }
    } else if (compType === 5125) { // UNSIGNED_INT
        for (let i=0;i<count;i++){
            out[i] = buffer.readUInt32LE(off); off += 4;
        }
    } else if (compType === 5121) { // UNSIGNED_BYTE
        for (let i=0;i<count;i++){
            out[i] = buffer.readUInt8(off); off += 1;
        }
    } else {
        throw new Error("Unsupported index componentType: " + compType);
    }
    return out;
}

function meshFromGLB(glb) {
    const json = glb.json;
    const bin = glb.binChunk;
    if (!json.meshes || json.meshes.length === 0) throw new Error("No meshes inside GLB");
    const meshDef = json.meshes[0];
    if (!meshDef.primitives || meshDef.primitives.length === 0) throw new Error("No primitives");
    const prim = meshDef.primitives[0];

    const rmesh = new RobloxMesh();

    // POSITION required
    if (!prim.attributes || prim.attributes.POSITION === undefined) throw new Error("No POSITION attribute");
    const posAccIdx = prim.attributes.POSITION;
    const pos = accessorReadFloatArray(json, bin, posAccIdx);
    // norm and uv optional
    let norm = null, uv = null;
    if (prim.attributes.NORMAL !== undefined) norm = accessorReadFloatArray(json, bin, prim.attributes.NORMAL);
    if (prim.attributes.TEXCOORD_0 !== undefined) uv = accessorReadFloatArray(json, bin, prim.attributes.TEXCOORD_0);

    const vcount = pos.count;
    rmesh.vertices = [];
    for (let i=0;i<vcount;i++){
        const vx = pos.data[i*pos.numComp + 0] || 0;
        const vy = pos.data[i*pos.numComp + 1] || 0;
        const vz = pos.data[i*pos.numComp + 2] || 0;
        const nx = (norm ? norm.data[i*norm.numComp + 0] : 0) || 0;
        const ny = (norm ? norm.data[i*norm.numComp + 1] : 0) || 0;
        const nz = (norm ? norm.data[i*norm.numComp + 2] : 0) || 0;
        const tu = (uv ? uv.data[i*uv.numComp + 0] : 0) || 0;
        const tv = (uv ? uv.data[i*uv.numComp + 1] : 0) || 0;
        rmesh.vertices.push({vx,vy,vz,nx,ny,nz,tu,tv,tw:0});
    }

    // indices
    rmesh.faces = [];
    if (prim.indices !== undefined && prim.indices !== -1) {
        const idxArr = accessorReadIndices(json, bin, prim.indices);
        for (let i=0;i+2<idxArr.length;i+=3){
            rmesh.faces.push({a: idxArr[i]>>>0, b: idxArr[i+1]>>>0, c: idxArr[i+2]>>>0});
        }
    } else {
        // no indices: assume triangle list of positions
        for (let i=0;i+2<rmesh.vertices.length;i+=3){
            rmesh.faces.push({a:i,b:i+1,c:i+2});
        }
    }

    return rmesh;
}

function writeGLB(outPath, mesh) {
    // Build binary buffer: positions, normals, uvs, indices (uint32)
    const posBuf = Buffer.alloc(mesh.vertices.length * 3 * 4);
    const normBuf = Buffer.alloc(mesh.vertices.length * 3 * 4);
    const uvBuf = Buffer.alloc(mesh.vertices.length * 2 * 4);
    let off = 0;
    for (let v of mesh.vertices) {
        posBuf.writeFloatLE(v.vx || 0, off); off += 4;
        posBuf.writeFloatLE(v.vy || 0, off); off += 4;
        posBuf.writeFloatLE(v.vz || 0, off); off += 4;
    }
    off = 0;
    for (let v of mesh.vertices) {
        normBuf.writeFloatLE(v.nx || 0, off); off += 4;
        normBuf.writeFloatLE(v.ny || 0, off); off += 4;
        normBuf.writeFloatLE(v.nz || 0, off); off += 4;
    }
    off = 0;
    for (let v of mesh.vertices) {
        uvBuf.writeFloatLE(v.tu || 0, off); off += 4;
        uvBuf.writeFloatLE(v.tv || 0, off); off += 4;
    }

    // indices uint32
    const idxBuf = Buffer.alloc(mesh.faces.length * 3 * 4);
    off = 0;
    for (let f of mesh.faces) {
        idxBuf.writeUInt32LE(f.a >>> 0, off); off += 4;
        idxBuf.writeUInt32LE(f.b >>> 0, off); off += 4;
        idxBuf.writeUInt32LE(f.c >>> 0, off); off += 4;
    }

    // build bin by concatenation and align each part to 4 bytes
    let cursor = 0;
    const posOffset = cursor; cursor += posBuf.length; cursor = align4(cursor);
    const normOffset = cursor; cursor += normBuf.length; cursor = align4(cursor);
    const uvOffset = cursor; cursor += uvBuf.length; cursor = align4(cursor);
    const idxOffset = cursor; cursor += idxBuf.length; cursor = align4(cursor);
    const binTotal = idxOffset + 0; // but we'll concat with padding after each

    // Create full bin buffer with padding
    const parts = [];
    parts.push(posBuf);
    if (posBuf.length % 4 !== 0) parts.push(Buffer.alloc(4 - (posBuf.length % 4)));
    parts.push(normBuf);
    if (normBuf.length % 4 !== 0) parts.push(Buffer.alloc(4 - (normBuf.length % 4)));
    parts.push(uvBuf);
    if (uvBuf.length % 4 !== 0) parts.push(Buffer.alloc(4 - (uvBuf.length % 4)));
    parts.push(idxBuf);
    if (idxBuf.length % 4 !== 0) parts.push(Buffer.alloc(4 - (idxBuf.length % 4)));

    const binChunk = Buffer.concat(parts);

    // Build JSON
    const bufferViewBase = [];
    let bvOffset = 0;
    // positions bufferView 0
    bufferViewBase.push({
        buffer: 0,
        byteOffset: 0,
        byteLength: posBuf.length,
        target: 34962 // ARRAY_BUFFER
    });
    bvOffset += align4(posBuf.length);
    // normals 1
    bufferViewBase.push({
        buffer: 0,
        byteOffset: bvOffset,
        byteLength: normBuf.length,
        target: 34962
    });
    bvOffset += align4(normBuf.length);
    // uvs 2
    bufferViewBase.push({
        buffer: 0,
        byteOffset: bvOffset,
        byteLength: uvBuf.length,
        target: 34962
    });
    bvOffset += align4(uvBuf.length);
    // indices 3
    bufferViewBase.push({
        buffer: 0,
        byteOffset: bvOffset,
        byteLength: idxBuf.length,
        target: 34963 // ELEMENT_ARRAY_BUFFER
    });
    bvOffset += align4(idxBuf.length);

    // Accessors
    const accessors = [];
    // pos accessor 0
    // compute min/max
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for (let v of mesh.vertices) {
        minX = Math.min(minX, v.vx||0);
        minY = Math.min(minY, v.vy||0);
        minZ = Math.min(minZ, v.vz||0);
        maxX = Math.max(maxX, v.vx||0);
        maxY = Math.max(maxY, v.vy||0);
        maxZ = Math.max(maxZ, v.vz||0);
    }
    accessors.push({
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: mesh.vertices.length,
        type: "VEC3",
        min: [minX===Infinity?0:minX, minY===Infinity?0:minY, minZ===Infinity?0:minZ],
        max: [maxX===-Infinity?0:maxX, maxY===-Infinity?0:maxY, maxZ===-Infinity?0:maxZ]
    });
    // normal accessor 1
    accessors.push({
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126,
        count: mesh.vertices.length,
        type: "VEC3"
    });
    // uv accessor 2
    accessors.push({
        bufferView: 2,
        byteOffset: 0,
        componentType: 5126,
        count: mesh.vertices.length,
        type: "VEC2"
    });
    // index accessor 3
    accessors.push({
        bufferView: 3,
        byteOffset: 0,
        componentType: 5125, // UNSIGNED_INT
        count: mesh.faces.length * 3,
        type: "SCALAR"
    });

    // mesh/primitive
    const gltfMesh = {
        primitives: [
            {
                attributes: {POSITION:0, NORMAL:1, TEXCOORD_0:2},
                indices: 3,
                mode: 4 // TRIANGLES
            }
        ]
    };

    const json = {
        asset: { version: "2.0", generator: "meshconv-js" },
        buffers: [{ byteLength: binChunk.length }],
        bufferViews: bufferViewBase,
        accessors: accessors,
        meshes: [gltfMesh],
        nodes: [{ mesh: 0 }],
        scenes: [{ nodes: [0] }],
        scene: 0
    };

    // JSON chunk must be padded to 4 bytes with spaces (0x20)
    let jsonText = JSON.stringify(json, null, 2);
    const jsonBuf = Buffer.from(jsonText, 'utf8');
    const jsonPad = (4 - (jsonBuf.length %4)) % 4;
    const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

    // Build final GLB: header (12) + JSON chunk header(8) + jsonChunk + BIN chunk header(8) + binChunk
    const binPad = (4 - (binChunk.length % 4)) % 4;
    const binChunkPadded = Buffer.concat([binChunk, Buffer.alloc(binPad)]);

    const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunkPadded.length;
    const header = Buffer.alloc(12);
    header.write('glTF', 0, 'ascii');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLength, 8);

    const jsonChunkHeader = Buffer.alloc(8);
    jsonChunkHeader.writeUInt32LE(jsonChunk.length, 0);
    jsonChunkHeader.write('JSON', 4, 'ascii');

    const binChunkHeader = Buffer.alloc(8);
    binChunkHeader.writeUInt32LE(binChunkPadded.length, 0);
    // write 'BIN\0'
    binChunkHeader.write('BIN\0', 4, 'ascii');

    const out = Buffer.concat([header, jsonChunkHeader, jsonChunk, binChunkHeader, binChunkPadded]);
    fs.writeFileSync(outPath, out);
}

// --- Main CLI logic ---
function printUsageAndExit() {
    console.log("Usage:\n  node index.js input.mesh output.glb\n  node meshconv.js input.glb output.mesh");
    process.exit(1);
}

if (require.main === module) {
    const argv = process.argv;
    if (argv.length < 4) printUsageAndExit();

    const inPath = argv[2];
    const outPath = argv[3];
    const inExt = path.extname(inPath).toLowerCase();
    const outExt = path.extname(outPath).toLowerCase();

    try {
        if ((inExt === '.mesh') && (outExt === '.glb' || outExt === '.gltf')) {
            const buf = fs.readFileSync(inPath);
            const {mesh, version} = RobloxMesh.fromMeshFile(buf);
            console.log("Loaded .mesh version:", version, "verts:", mesh.vertices.length, "faces:", mesh.faces.length);
            writeGLB(outPath, mesh);
            console.log("Wrote GLB:", outPath);
        } else if ((inExt === '.glb' || inExt === '.gltf') && outExt === '.mesh') {
            const glb = readGLB(inPath);
            const mesh = meshFromGLB(glb);
            console.log("Parsed GLB -> verts:", mesh.vertices.length, "faces:", mesh.faces.length);
            const outBuf = RobloxMesh.toMeshBuffer(mesh);
            fs.writeFileSync(outPath, outBuf);
            console.log("Wrote .mesh (v2.00):", outPath);
        } else {
            console.error("Unsupported conversion pair:", inExt, "->", outExt);
            printUsageAndExit();
        }
    } catch (e) {
        console.error("Error:", e.message);
        process.exit(2);
    }
}
