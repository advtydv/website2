/**
 * SynapseFlowBackground (v2 - Energetic Network Flow)
 * Simulates network activity with visible connections, traveling pulses,
 * line highlighting, and node activation effects.
 */

class SynapseFlowBackgroundV2 {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) { console.error(`SynapseFlowV2 Error: Canvas "${canvasId}" not found.`); return; }
      console.log("SynapseFlowV2: Canvas found.");
  
      this.gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: false, antialias: true })
             || this.canvas.getContext('experimental-webgl', { preserveDrawingBuffer: false, antialias: true });
      if (!this.gl) { console.error('SynapseFlowV2 Error: WebGL not supported.'); return; }
      console.log("SynapseFlowV2: WebGL context obtained.");
  
      // --- Configuration ---
      this.nodeCount = 25;       // Reduced count for clarity
      this.connectionRadius = 0.5; // Max distance for initial connection
      this.maxConnectionsPerNode = 7; // Limit static connections
      this.maxPulses = 50;       // Max concurrent pulses
      this.pulseSpeed = 0.6;      // Speed relative to edge length per second
      this.fireProbability = 0.001; // Base spontaneous fire chance
      this.stimulatedFireProbBoost = 0.8; // High chance to fire upon receiving pulse
      this.mouseInfluenceRadiusSq = 0.3 * 0.3; // Use squared for efficiency
      this.mouseFireBoost = 0.02;
      this.nodeBaseBrightness = 0.15;
      this.nodeReceiveBrightnessBoost = 1.5; // Additive boost on receive
      this.nodeFireBrightnessBoost = 1.0;
      this.nodeBrightnessDecay = 0.94; // Decay factor per frame
      this.pulseBaseBrightness = 1.8; // Pulses are bright
      this.activeLineBrightness = 0.9;
  
      // --- State ---
      this.nodes = [];            // { pos: [x, y], velocity: [vx, vy], brightness: b, connections: [idx1, idx2,...] }
      this.edges = [];            // { node1Idx: i, node2Idx: j } - Static connections
      this.pulses = [];           // { edgeIdx: i, progress: p (0-1), direction: +/-1, brightness: b }
      this.lineVertices = null;   // Buffer data for all static lines
      this.activeLineVertices = null; // Buffer data for highlighted lines
      this.nodeVertices = null;   // Buffer data for nodes
      this.pulseVertices = null;  // Buffer data for pulses
  
      // GL Programs & Resources
      this.lineProgram = null;
      this.pointProgram = null; // One program for nodes and pulses
      // Buffers
      this.staticLineBuffer = null;
      this.activeLineBuffer = null;
      this.nodeBuffer = null;
      this.pulseBuffer = null;
      // Locations (common attributes/uniforms might share locations across programs)
      this.locations = {}; // Store locations dynamically
  
      // Interaction & Timing
      this.mousePos = [-5,-5];
      this.startTime = Date.now();
      this.lastFrameTime = this.startTime;
  
      // --- Initialization ---
      this.generateNetwork(); // Creates nodes and edges
      this.initGL();        // Setup WebGL programs, buffers, locations
  
      if (!this.lineProgram || !this.pointProgram) { console.error("SynapseFlowV2 Error: Failed init."); return; }
  
      this.animate();
      this.setupResizeHandler();
      this.setupMousePositionHandler();
      this.setupContextHandlers();
    }
  
    /** Generates nodes and calculates static connections */
    generateNetwork() {
      this.nodes = [];
      this.edges = [];
      const tempNodeData = []; // For building vertex buffer
  
      // 1. Create Nodes
      for (let i = 0; i < this.nodeCount; i++) {
        const node = {
          id: i,
          pos: [Math.random() * 2 - 1, Math.random() * 2 - 1],
          velocity: [(Math.random() - 0.5) * 0.0005, (Math.random() - 0.5) * 0.0005],
          brightness: this.nodeBaseBrightness,
          connections: [] // Store indices of connected nodes
        };
        this.nodes.push(node);
        tempNodeData.push(node.pos[0], node.pos[1], node.brightness);
      }
      this.nodeVertices = new Float32Array(tempNodeData);
  
      // 2. Calculate Edges (Connect nearby nodes)
      const connectionRadiusSq = this.connectionRadius * this.connectionRadius;
      const edgeVertices = [];
      for (let i = 0; i < this.nodeCount; i++) {
        const node1 = this.nodes[i];
        // Sort other nodes by distance to node1
        const neighbors = [];
        for (let j = 0; j < this.nodeCount; j++) {
            if (i === j) continue;
            const node2 = this.nodes[j];
            const dx = node1.pos[0] - node2.pos[0];
            const dy = node1.pos[1] - node2.pos[1];
            const distSq = dx * dx + dy * dy;
            if (distSq < connectionRadiusSq) {
                neighbors.push({ index: j, distSq: distSq });
            }
        }
        // Sort by distance and take the closest ones
        neighbors.sort((a, b) => a.distSq - b.distSq);
  
        let connectionsMade = 0;
        for(let k=0; k < neighbors.length && connectionsMade < this.maxConnectionsPerNode; k++) {
            const neighborIdx = neighbors[k].index;
            // Avoid duplicate connections (check if neighbor already connected to i)
            if (!this.nodes[neighborIdx].connections.includes(i)) {
                const node2 = this.nodes[neighborIdx];
                this.edges.push({ node1Idx: i, node2Idx: neighborIdx });
                node1.connections.push(neighborIdx);
                node2.connections.push(i); // Add reciprocal connection for lookup
                // Add vertices for this line segment
                edgeVertices.push(node1.pos[0], node1.pos[1], node2.pos[0], node2.pos[1]);
                connectionsMade++;
            }
        }
      }
      this.lineVertices = new Float32Array(edgeVertices);
      console.log(`SynapseFlowV2: Generated ${this.nodeCount} nodes and ${this.edges.length} edges.`);
    }
  
     /** Compile Shader Helper */
     compileShader(source, type, name) { const gl=this.gl; const s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error(`SynapseFlowV2 ${name} Shader Error: ${gl.getShaderInfoLog(s)}`); gl.deleteShader(s); return null;} return s; }
     /** Create Program Helper */
     createProgram(vs, fs, name) { const gl=this.gl; const p=gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,fs); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.error(`SynapseFlowV2 ${name} Link Error: ${gl.getProgramInfoLog(p)}`); gl.deleteProgram(p); return null;} gl.detachShader(p,vs); gl.detachShader(p,fs); gl.deleteShader(vs); gl.deleteShader(fs); return p; }
     /** Get Location Helper */
     getLocation(program, name, isUniform) {
         const gl = this.gl;
         const loc = isUniform ? gl.getUniformLocation(program, name) : gl.getAttribLocation(program, name);
         if (loc === null || loc === -1) { console.warn(`SynapseFlowV2 Warn: Location "${name}" not found or inactive.`); }
         this.locations[name] = loc; // Store location
         return loc !== null && loc !== -1; // Return true if found
     }
  
  
    /** Initializes WebGL programs, buffers, and locations */
    initGL() {
      const gl = this.gl;
      while(gl.getError() !== gl.NO_ERROR) {}
  
      // --- Shader Definitions ---
      // Shader for static faint lines and dynamic bright lines
      const lineVS = ` attribute vec2 a_pos; uniform vec2 u_resolution; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); } `;
      const lineFS = ` precision lowp float; uniform vec4 u_color; void main() { gl_FragColor = u_color; } `;
  
      // Shader for points (nodes and pulses) - uses brightness attribute
      const pointVS = `
        attribute vec3 a_vertexData; // x, y, brightness
        uniform float u_pointSize;
        varying float v_brightness;
        void main() {
          gl_PointSize = u_pointSize;
          gl_Position = vec4(a_vertexData.xy, 0.0, 1.0);
          v_brightness = a_vertexData.z;
        }
      `;
      const pointFS = `
        precision highp float;
        varying float v_brightness;
        void main() {
          float dist = distance(gl_PointCoord, vec2(0.5));
          // Sharp core, soft outer glow
          float core = smoothstep(0.0, 0.15, 1.0 - dist) * 1.5;
          float shape = 1.0 - smoothstep(0.3, 0.5, dist);
          float intensity = min(1.0, (shape + core) * v_brightness);
          // Use intensity for color and alpha with additive blending
          gl_FragColor = vec4(intensity, intensity, intensity, intensity);
        }
      `;
  
      // --- Compile & Link Programs ---
      let vs = this.compileShader(lineVS, gl.VERTEX_SHADER, "Line");
      let fs = this.compileShader(lineFS, gl.FRAGMENT_SHADER, "Line");
      if (!vs || !fs) { this.lineProgram = null; return; }
      this.lineProgram = this.createProgram(vs, fs, "Line");
  
      vs = this.compileShader(pointVS, gl.VERTEX_SHADER, "Point");
      fs = this.compileShader(pointFS, gl.FRAGMENT_SHADER, "Point");
       if (!vs || !fs) { this.pointProgram = null; return; }
      this.pointProgram = this.createProgram(vs, fs, "Point");
  
      if (!this.lineProgram || !this.pointProgram) { console.error("SynapseFlowV2 Error: Program creation failed."); return; }
      console.log("SynapseFlowV2: Programs Initialized.");
  
      // --- Get Locations ---
      this.getLocation(this.lineProgram, 'a_pos', false);
      this.getLocation(this.lineProgram, 'u_resolution', true); // Though unused, good practice
      this.getLocation(this.lineProgram, 'u_color', true);
  
      this.getLocation(this.pointProgram, 'a_vertexData', false);
      this.getLocation(this.pointProgram, 'u_resolution', true); // Unused here too
      this.getLocation(this.pointProgram, 'u_pointSize', true);
  
      // --- Create Buffers ---
      // Static Lines
      this.staticLineBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.staticLineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.lineVertices, gl.STATIC_DRAW);
  
      // Active Lines (Dynamic) - Allocate max possible size (all edges * 2 vertices * 2 floats)
      this.activeLineBuffer = gl.createBuffer();
      this.activeLineVertices = new Float32Array(this.edges.length * 4); // Max size needed
      gl.bindBuffer(gl.ARRAY_BUFFER, this.activeLineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.activeLineVertices.byteLength, gl.DYNAMIC_DRAW);
  
      // Nodes (Dynamic brightness)
      this.nodeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.nodeVertices.byteLength, gl.DYNAMIC_DRAW); // Use DYNAMIC now
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.nodeVertices); // Initial data
  
      // Pulses (Dynamic)
      this.pulseBuffer = gl.createBuffer();
      this.pulseVertices = new Float32Array(this.maxPulses * 3); // x, y, brightness
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pulseBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.pulseVertices.byteLength, gl.DYNAMIC_DRAW);
  
      console.log("SynapseFlowV2: Buffers created.");
      this.resizeCanvas(); // Set initial size/resolution uniform
  
      const error = gl.getError(); if(error !== gl.NO_ERROR) console.error(`SynapseFlowV2 GL Init Error: ${error}`);
      else console.log("SynapseFlowV2: WebGL Initialized.");
    }
  
    /** Update Simulation Logic */
    updateSimulation(deltaTime) {
        // 1. Update Node Positions & Decay Brightness
        this.nodes.forEach(node => {
            node.pos[0] += node.velocity[0] * deltaTime * 60; node.pos[1] += node.velocity[1] * deltaTime * 60;
            if (node.pos[0] > 1.1) node.pos[0] = -1.1; else if (node.pos[0] < -1.1) node.pos[0] = 1.1; if (node.pos[1] > 1.1) node.pos[1] = -1.1; else if (node.pos[1] < -1.1) node.pos[1] = 1.1;
            node.brightness = Math.max(this.nodeBaseBrightness, node.brightness * this.nodeBrightnessDecay);
        });
  
        // 2. Update Pulses & Handle Arrival
        const arrivedPulsesData = []; // Store { targetNodeIndex, edgeIdx }
        this.pulses = this.pulses.filter(pulse => {
            const edge = this.edges[pulse.edgeIdx];
            if (!edge) return false; // Invalid edge reference
  
            const node1 = this.nodes[edge.node1Idx];
            const node2 = this.nodes[edge.node2Idx];
            if (!node1 || !node2) return false; // Invalid node reference
  
            const edgeLength = Math.hypot(node2.pos[0] - node1.pos[0], node2.pos[1] - node1.pos[1]);
            if (edgeLength < 0.001) return false; // Avoid division by zero if nodes overlap
  
            // Progress along the edge based on speed and time
            pulse.progress += (this.pulseSpeed * deltaTime) / edgeLength;
  
            if (pulse.progress >= 1.0) {
                // Arrived at the destination node
                const targetNodeIndex = (pulse.direction === 1) ? edge.node2Idx : edge.node1Idx;
                if (this.nodes[targetNodeIndex]) {
                    this.nodes[targetNodeIndex].brightness = Math.min(2.0, this.nodes[targetNodeIndex].brightness + this.nodeReceiveBrightnessBoost); // Boost target brightness (can exceed 1 briefly)
                    arrivedPulsesData.push({ targetNodeIndex: targetNodeIndex, edgeIdx: pulse.edgeIdx });
                }
                return false; // Remove pulse
            } else {
                // Pulse brightness remains high while traveling
                pulse.brightness = this.pulseBaseBrightness;
                return true; // Keep pulse
            }
        });
  
        // 3. Firing Logic
        this.nodes.forEach((node, index) => {
            let currentFireProb = this.fireProbability;
            // Mouse influence
            const dx = node.pos[0] - this.mousePos[0]; const dy = node.pos[1] - this.mousePos[1]; const mouseDistSq = dx*dx + dy*dy;
            if (mouseDistSq < this.mouseInfluenceRadiusSq) {
                currentFireProb += this.mouseFireBoost * (1.0 - Math.sqrt(mouseDistSq) / Math.sqrt(this.mouseInfluenceRadiusSq));
            }
            // Stimulated firing
            if (arrivedPulsesData.some(p => p.targetNodeIndex === index)) {
                currentFireProb += this.stimulatedFireProbBoost;
            }
  
            // Attempt to fire if probability met and connections exist
            if (this.pulses.length < this.maxPulses && node.connections.length > 0 && Math.random() < currentFireProb) {
                this.firePulseFromNode(index);
            }
        });
    }
  
    /** Fire a pulse from a node along a random connection */
    firePulseFromNode(nodeIndex) {
        const node = this.nodes[nodeIndex];
        if (!node || node.connections.length === 0) return;
  
        // Choose a random connection
        const targetNodeIndex = node.connections[Math.floor(Math.random() * node.connections.length)];
  
        // Find the edge index corresponding to this connection
        const edgeIdx = this.edges.findIndex(edge =>
            (edge.node1Idx === nodeIndex && edge.node2Idx === targetNodeIndex) ||
            (edge.node1Idx === targetNodeIndex && edge.node2Idx === nodeIndex)
        );
  
        if (edgeIdx === -1) {
            // console.warn("SynapseFlowV2: Could not find edge for connection.");
             return; // Should not happen if connections are built correctly
        }
  
        // Determine direction (+1 if nodeIndex is node1, -1 if it's node2)
        const direction = (this.edges[edgeIdx].node1Idx === nodeIndex) ? 1 : -1;
  
        // Boost firing node brightness
        node.brightness = Math.min(2.0, node.brightness + this.nodeFireBrightnessBoost);
  
        this.pulses.push({
            edgeIdx: edgeIdx,
            progress: 0, // Start at the beginning
            direction: direction,
            brightness: this.pulseBaseBrightness
        });
    }
  
    /** Render the current state */
    render() {
        const gl = this.gl;
        if (!this.lineProgram || !this.pointProgram) return; // Ensure programs are valid
  
        // --- Prepare buffer data ---
        // Nodes
        const nodeData = [];
        this.nodes.forEach(node => nodeData.push(node.pos[0], node.pos[1], node.brightness));
        gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(nodeData));
  
        // Pulses & Active Lines
        const pulseData = [];
        const activeLineData = [];
        this.pulses.forEach(pulse => {
            const edge = this.edges[pulse.edgeIdx];
            if (!edge) return;
            const node1 = this.nodes[edge.node1Idx];
            const node2 = this.nodes[edge.node2Idx];
            if (!node1 || !node2) return;
  
            // Calculate pulse position along the edge
            const progress = (pulse.direction === 1) ? pulse.progress : 1.0 - pulse.progress;
            const currentX = node1.pos[0] + (node2.pos[0] - node1.pos[0]) * progress;
            const currentY = node1.pos[1] + (node2.pos[1] - node1.pos[1]) * progress;
            pulseData.push(currentX, currentY, pulse.brightness);
  
            // Add vertices for the brightened active line segment
            activeLineData.push(node1.pos[0], node1.pos[1], node2.pos[0], node2.pos[1]);
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, this.pulseBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(pulseData));
        gl.bindBuffer(gl.ARRAY_BUFFER, this.activeLineBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(activeLineData));
  
  
        // --- Render ---
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.clearColor(0.0, 0.0, 0.0, 0.0); // Clear transparent black
        gl.clear(gl.COLOR_BUFFER_BIT);
  
        gl.enable(gl.BLEND);
        // Use additive blending for all elements for a bright, layered look
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  
  
        // --- 1. Draw Static Lines (Faint) ---
        gl.useProgram(this.lineProgram);
        gl.uniform4f(this.locations['u_color'], 0.15, 0.15, 0.15, 0.1); // Very faint white/grey
        gl.bindBuffer(gl.ARRAY_BUFFER, this.staticLineBuffer);
        gl.enableVertexAttribArray(this.locations['a_pos']);
        gl.vertexAttribPointer(this.locations['a_pos'], 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, this.edges.length * 2); // 2 vertices per edge
  
        // --- 2. Draw Active Lines (Bright) ---
        if (activeLineData.length > 0) {
          gl.uniform4f(this.locations['u_color'], this.activeLineBrightness, this.activeLineBrightness, this.activeLineBrightness, 0.7); // Brighter white
          gl.bindBuffer(gl.ARRAY_BUFFER, this.activeLineBuffer);
          gl.enableVertexAttribArray(this.locations['a_pos']); // Rebind might not be needed if same attribute location
          gl.vertexAttribPointer(this.locations['a_pos'], 2, gl.FLOAT, false, 0, 0);
          gl.drawArrays(gl.LINES, 0, activeLineData.length / 2); // Draw active lines
        }
  
        // --- 3. Draw Nodes ---
        gl.useProgram(this.pointProgram);
        gl.uniform1f(this.locations['u_pointSize'], 4.0); // Node size
        gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffer);
        gl.enableVertexAttribArray(this.locations['a_vertexData']);
        gl.vertexAttribPointer(this.locations['a_vertexData'], 3, gl.FLOAT, false, 0, 0); // x, y, brightness
        gl.drawArrays(gl.POINTS, 0, this.nodeCount);
  
        // --- 4. Draw Pulses ---
        if (pulseData.length > 0) {
          gl.uniform1f(this.locations['u_pointSize'], 5.0); // Pulse size (larger)
          gl.bindBuffer(gl.ARRAY_BUFFER, this.pulseBuffer);
          gl.enableVertexAttribArray(this.locations['a_vertexData']); // Rebind might not be needed
          gl.vertexAttribPointer(this.locations['a_vertexData'], 3, gl.FLOAT, false, 0, 0);
          gl.drawArrays(gl.POINTS, 0, pulseData.length / 3); // Draw active pulses
        }
  
  
        // Cleanup
        gl.disableVertexAttribArray(this.locations['a_pos']); // From line program
        gl.disableVertexAttribArray(this.locations['a_vertexData']); // From point program
        gl.disable(gl.BLEND);
    }
  
    /** Animation loop */
    animate() {
      if (!this.gl || this.gl.isContextLost() || !this.lineProgram || !this.pointProgram) { return; } // Check both programs
      const now = Date.now(); const deltaTime = (now - this.lastFrameTime) / 1000.0; this.lastFrameTime = now;
      this.updateSimulation(deltaTime); this.render();
      requestAnimationFrame(this.animate.bind(this));
    }
  
    // --- Event Handlers (Mostly Unchanged) ---
    resizeCanvas() {
      // Ensure GL context, canvas, and parentElement exist
      if (!this.gl || this.gl.isContextLost() || !this.canvas || !this.canvas.parentElement) {
          // console.warn("SynapseFlowV2: Resize aborted - GL context, canvas, or parent missing.");
          return;
      }
  
      const parent = this.canvas.parentElement;
      
      // Use getBoundingClientRect for accurate dimensions of the parent,
      // which accounts for CSS transformations and box-sizing.
      const parentRect = parent.getBoundingClientRect();
  
      const dpr = window.devicePixelRatio || 1;
  
      // Dimensions for the canvas element's display size (CSS pixels)
      // These should match the actual rendered size of the parent's content box.
      const displayWidth = parentRect.width;
      const displayHeight = parentRect.height;
  
      // Dimensions for the WebGL drawing buffer (actual pixels)
      const bufferWidth = Math.round(displayWidth * dpr);
      const bufferHeight = Math.round(displayHeight * dpr);
  
      // Only resize if dimensions have actually changed to avoid unnecessary work
      if (this.canvas.width !== bufferWidth || this.canvas.height !== bufferHeight) {
          this.canvas.width = bufferWidth;
          this.canvas.height = bufferHeight;
  
          // It's good practice to also set the CSS style dimensions of the canvas element itself,
          // especially if its CSS is not already 'width: 100%; height: 100%;'.
          // This ensures the element's box model matches what you intend.
          this.canvas.style.width = `${displayWidth}px`;
          this.canvas.style.height = `${displayHeight}px`;
  
          // Update the WebGL viewport to match the new drawing buffer size
          this.gl.viewport(0, 0, bufferWidth, bufferHeight);
          // console.log(`SynapseFlowV2: Canvas resized - Buffer: ${bufferWidth}x${bufferHeight}, Display: ${displayWidth}x${displayHeight}`);
      }
      
      // If your shaders were dependent on a u_resolution uniform (they are not in the provided code, as they use normalized coordinates),
      // you would update that uniform here:
      // if (this.locations && this.locations['u_resolution']) { // Check if 'u_resolution' location was cached
      //     gl.useProgram(this.lineProgram); // Or whichever program uses it
      //     gl.uniform2f(this.locations['u_resolution'], bufferWidth, bufferHeight);
      //     gl.useProgram(this.pointProgram);
      //     gl.uniform2f(this.locations['u_resolution'], bufferWidth, bufferHeight);
      // }
  }    
  setupResizeHandler() { /* ... */ let t; window.addEventListener('resize',()=>{clearTimeout(t);t=setTimeout(()=>this.resizeCanvas(),100);}); }
    setupMousePositionHandler() { /* ... */ window.addEventListener('mousemove',(e)=>{const r=this.canvas.getBoundingClientRect();const x=((e.clientX-r.left)/r.width)*2-1;const y=((e.clientY-r.top)/r.height)*-2+1; this.mousePos=[x,y];},{passive:true}); this.canvas.addEventListener('mouseout',()=>{this.mousePos=[-5,-5];}); }
    setupContextHandlers() { /* ... */ this.canvas.addEventListener('webglcontextlost',(e)=>{console.warn('SynapseFlowV2 context lost.');e.preventDefault();},false); this.canvas.addEventListener('webglcontextrestored',()=>{console.info('SynapseFlowV2 context restored.'); this.initGL();},false); }
  
  } // End class
  
  // --- Initialize ---
  document.addEventListener('DOMContentLoaded', () => {
    console.log("SynapseFlowV2: DOMContentLoaded, initializing...");
    try {
      const synapseBackground = new SynapseFlowBackgroundV2('synapseCanvas');
      if (!synapseBackground || !synapseBackground.gl || !synapseBackground.lineProgram || !synapseBackground.pointProgram) {
          throw new Error("SynapseFlowV2 failed init.");
       }
      console.log("SynapseFlowV2: Init successful.");
    } catch(error) {
      console.error("Failed to initialize SynapseFlowV2:", error);
      const canvasEl = document.getElementById('synapseCanvas'); if(canvasEl) canvasEl.style.display = 'none';
    }
  });