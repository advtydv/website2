/**
 * MonochromeFlowFieldAnimation (v1.3.2 - SimplexNoise Scope Fix Applied)
 * Simulates dense line segments moving through a multi-octave Simplex noise field (fBm).
 */

class SimplexNoise {
    static F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
    static G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
    static F3 = 1.0 / 3.0; 
    static G3 = 1.0 / 6.0;

    constructor(randomOrSeed = Math.random) {
        if (typeof randomOrSeed === 'number') {
            this.random = () => { 
                randomOrSeed = (randomOrSeed * 1664525 + 1013904223) % 4294967296;
                return randomOrSeed / 4294967296;
            };
        } else {
            this.random = randomOrSeed;
        }
        this.p = new Uint8Array(256);
        this.perm = new Uint8Array(512);
        this.permMod12 = new Uint8Array(512);
        for (let i = 0; i < 256; i++) this.p[i] = i;
        for (let i = 255; i > 0; i--) {
            const r = Math.floor(this.random() * (i + 1));
            const temp = this.p[i]; this.p[i] = this.p[r]; this.p[r] = temp;
        }
        for (let i = 0; i < 512; i++) {
            this.perm[i] = this.p[i & 255];
            this.permMod12[i] = this.perm[i] % 12;
        }
    }

    grad3 = new Float32Array([ 
        1,1,0,  -1,1,0,  1,-1,0,  -1,-1,0,
        1,0,1,  -1,0,1,  1,0,-1,  -1,0,-1,
        0,1,1,  0,-1,1,  0,1,-1,  0,-1,-1
    ]);

    dot(g, x, y) { return g[0]*x + g[1]*y; }

    noise2D(xin, yin) {
        let n0, n1, n2;
        const s = (xin + yin) * SimplexNoise.F2; 
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const t = (i + j) * SimplexNoise.G2;    
        const X0 = i - t; const Y0 = j - t;
        const x0 = xin - X0; const y0 = yin - Y0;
        let i1, j1; if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }      
        const x1 = x0 - i1 + SimplexNoise.G2; const y1 = y0 - j1 + SimplexNoise.G2;
        const x2 = x0 - 1.0 + 2.0 * SimplexNoise.G2; const y2 = y0 - 1.0 + 2.0 * SimplexNoise.G2;
        const ii = i & 255; const jj = j & 255;
        const gi0 = this.permMod12[ii + this.perm[jj]] * 3;
        const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]] * 3;
        const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]] * 3;
        let t0 = 0.5 - x0*x0 - y0*y0; if (t0 < 0) n0 = 0.0; else { t0 *= t0; n0 = t0*t0 * this.dot(this.grad3.subarray(gi0, gi0+2), x0, y0); }
        let t1 = 0.5 - x1*x1 - y1*y1; if (t1 < 0) n1 = 0.0; else { t1 *= t1; n1 = t1*t1 * this.dot(this.grad3.subarray(gi1, gi1+2), x1, y1); }
        let t2 = 0.5 - x2*x2 - y2*y2; if (t2 < 0) n2 = 0.0; else { t2 *= t2; n2 = t2*t2 * this.dot(this.grad3.subarray(gi2, gi2+2), x2, y2); }
        return 70.0 * (n0 + n1 + n2);
    }
}

class MonochromeFlowFieldAnimation {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) { console.error(`MFF Error: Canvas "${canvasId}" not found.`); this.valid = false; return; }
        this.gl = this.canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false }) ||
                  this.canvas.getContext('experimental-webgl', { antialias: false, preserveDrawingBuffer: false });
        if (!this.gl) { console.error('MFF Error: WebGL not supported.'); this.valid = false; return; }
        this.valid = true;
        console.log("MFF: WebGL context obtained.");

        this.config = {
            backgroundColor: [1.0, 1.0, 1.0, 1.0], 
            numParticles: 50000,      
            lineWidth: 1.0,          
            baseParticleSpeed: 0.001, 
            speedVariation: 0.0005,
            maxAge: 160,              
            fBmOctaves: 4,            
            fBmPersistence: 0.45,     
            fBmLacunarity: 2.1,       
            baseNoiseScale: 1.5,      
            noiseTimeScale: 0.03,     
            fieldStrength: Math.PI * 2.2, 
            defaultParticleRGB: [0.85, 0.85, 0.95], // A bright, slightly cool "white" as the base
            globalParticleAlpha: 1.0, // Start low for additive, we can increase if needed
            tintPalette: [
                [0, 0, 0.803921568627451]
            ], //[0, 0, 0.803921568627451] matches the heading, [0.4, 0.5, 1.0] is the normie one
            tintProbability: 1,
        };

        this.particles = [];
        this.lineVertexBuffer = null;
        this.lineVertexData = new Float32Array(this.config.numParticles * 2 * 6); 
        this.program = null; this.locations = {}; this.simplex = new SimplexNoise(); // Correctly instantiated
        this.time = 0; this.lastFrameTime = 0;

        this.initParticles(); this.initGL();
        if (!this.program) { console.error("MFF Error: Failed GL init."); this.valid = false; return; }
        this.resizeCanvas(); this.animate();
        this.setupResizeHandler(); this.setupContextHandlers();
    }

    compileShader(source,type,name){const gl=this.gl;const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error(`MFF ${name} Shader Error: ${gl.getShaderInfoLog(s)}`);gl.deleteShader(s);return null;}return s;}
    createProgram(vsSrc,fsSrc,name){const gl=this.gl;const vs=this.compileShader(vsSrc,gl.VERTEX_SHADER,`${name} VS`);const fs=this.compileShader(fsSrc,gl.FRAGMENT_SHADER,`${name} FS`);if(!vs||!fs)return null;const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.error(`MFF ${name} Link Error: ${gl.getProgramInfoLog(p)}`);gl.deleteProgram(p);return null;}gl.detachShader(p,vs);gl.detachShader(p,fs);gl.deleteShader(vs);gl.deleteShader(fs);return p;}
    getLocation(prog,name,isUni){const gl=this.gl;const l=isUni?gl.getUniformLocation(prog,name):gl.getAttribLocation(prog,name);if(l===null||l===-1){console.warn(`MFF Warn: Loc "${name}" not found.`);}this.locations[name]=l;return l!==null&&l!==-1;}
    initParticles() {
        this.particles = [];
        for (let i = 0; i < this.config.numParticles; i++) {
            this.particles.push(this.createParticle(true));
        }
        console.log(`MFF: Initialized ${this.config.numParticles} particles.`);
    }

    createParticle(isInitialSpawn = false) {
        const x = Math.random() * 2.0 - 1.0;
        const y = Math.random() * 2.0 - 1.0;
        let rgb = [...this.config.defaultParticleRGB];
        if (Math.random() < this.config.tintProbability) {
            rgb = [...this.config.tintPalette[Math.floor(Math.random() * this.config.tintPalette.length)]];
        }
        const speed = this.config.baseParticleSpeed + (Math.random() * 2.0 - 1.0) * this.config.speedVariation;
        return {
            x: x, y: y, prev_x: x, prev_y: y, 
            age: isInitialSpawn ? Math.floor(Math.random() * this.config.maxAge) : 0, 
            rgb: rgb, speed: Math.max(0.00001, speed)
        };
    }

    initGL() {
        const gl = this.gl; if (!this.valid) return;
        const vsSource = `
            attribute vec2 a_position; attribute vec3 a_color; attribute float a_alphaMultiplier;
            varying vec3 v_color; varying float v_alphaMultiplier;
            void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_color = a_color; v_alphaMultiplier = a_alphaMultiplier; }`;
        const fsSource = `
            precision mediump float; uniform float u_globalAlpha;
            varying vec3 v_color; varying float v_alphaMultiplier;
            void main() { gl_FragColor = vec4(v_color, u_globalAlpha * v_alphaMultiplier); }`;

        this.program = this.createProgram(vsSource, fsSource, "FlowFieldLineProgram");
        if (!this.program) return;
        console.log("MFF: Line Program Initialized.");
        this.getLocation(this.program, 'a_position', false); this.getLocation(this.program, 'a_color', false);
        this.getLocation(this.program, 'a_alphaMultiplier', false); this.getLocation(this.program, 'u_globalAlpha', true);
        this.lineVertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.lineVertexData.byteLength, gl.DYNAMIC_DRAW);
        console.log("MFF: Line Buffers created.");
    }

    getVectorFieldAngle(x, y, time) {
        let totalNoise = 0.0; let amplitude = 1.0; let frequency = this.config.baseNoiseScale;
        let maxAmplitude = 0.0;
        for (let i = 0; i < this.config.fBmOctaves; i++) {
            totalNoise += this.simplex.noise2D(x * frequency, y * frequency + time) * amplitude;
            maxAmplitude += amplitude;
            amplitude *= this.config.fBmPersistence;
            frequency *= this.config.fBmLacunarity;
        }
        if (maxAmplitude > 0) totalNoise /= maxAmplitude; 
        return (totalNoise * 0.5 + 0.5) * this.config.fieldStrength;
    }

    updateParticles(deltaTime) {
        this.time += deltaTime * this.config.noiseTimeScale;
        const vertexDataStride = 6; 

        for (let i = 0; i < this.config.numParticles; i++) {
            let p = this.particles[i];
            p.age++;
            p.prev_x = p.x; p.prev_y = p.y;
            
            if (p.age > this.config.maxAge) {
                this.particles[i] = this.createParticle(false); p = this.particles[i];
            }
            
            const angle = this.getVectorFieldAngle(p.x, p.y, this.time);
            p.x += Math.cos(angle) * p.speed; p.y += Math.sin(angle) * p.speed;
            
            if (p.x > 1.05 || p.x < -1.05 || p.y > 1.05 || p.y < -1.05) {
                this.particles[i] = this.createParticle(false); p = this.particles[i];
            }
            
            const baseOffset = i * 2 * vertexDataStride;
            const ageRatio = 1.0 - (p.age / this.config.maxAge);
            const currAlphaMult = 1.0; // DEBUG: Force full alpha
            const prevAlphaMult = 1.0; // DEBUG: Force full alpha

            this.lineVertexData[baseOffset + 0] = p.prev_x; this.lineVertexData[baseOffset + 1] = p.prev_y;
            this.lineVertexData[baseOffset + 2] = p.rgb[0]; this.lineVertexData[baseOffset + 3] = p.rgb[1]; this.lineVertexData[baseOffset + 4] = p.rgb[2];
            this.lineVertexData[baseOffset + 5] = prevAlphaMult;
            this.lineVertexData[baseOffset + vertexDataStride + 0] = p.x; this.lineVertexData[baseOffset + vertexDataStride + 1] = p.y;
            this.lineVertexData[baseOffset + vertexDataStride + 2] = p.rgb[0]; this.lineVertexData[baseOffset + vertexDataStride + 3] = p.rgb[1]; this.lineVertexData[baseOffset + vertexDataStride + 4] = p.rgb[2];
            this.lineVertexData[baseOffset + vertexDataStride + 5] = currAlphaMult;
        }
    }

    render() {
        const gl = this.gl; if (!this.valid || !this.program || gl.isContextLost()) return;
        
        gl.clearColor(...this.config.backgroundColor); 
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.useProgram(this.program);
        gl.uniform1f(this.locations['u_globalAlpha'], this.config.globalParticleAlpha);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVertexBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lineVertexData);
        const strideBytes = 6 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(this.locations['a_position']);
        gl.vertexAttribPointer(this.locations['a_position'], 2, gl.FLOAT, false, strideBytes, 0);
        gl.enableVertexAttribArray(this.locations['a_color']);
        gl.vertexAttribPointer(this.locations['a_color'], 3, gl.FLOAT, false, strideBytes, 2 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(this.locations['a_alphaMultiplier']);
        gl.vertexAttribPointer(this.locations['a_alphaMultiplier'], 1, gl.FLOAT, false, strideBytes, 5 * Float32Array.BYTES_PER_ELEMENT);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // Standard alpha blending

        gl.drawArrays(gl.LINES, 0, this.config.numParticles * 2);
        
        gl.disableVertexAttribArray(this.locations['a_position']); 
        gl.disableVertexAttribArray(this.locations['a_color']);
        gl.disableVertexAttribArray(this.locations['a_alphaMultiplier']); 
        gl.disable(gl.BLEND);
    }

    animate(){if(!this.valid||this.gl.isContextLost()){return;}const n=Date.now();const dt=(this.lastFrameTime?(n-this.lastFrameTime)/1000.0:1/60);this.lastFrameTime=n;this.updateParticles(dt);this.render();requestAnimationFrame(this.animate.bind(this));}
    resizeCanvas() {
        if (!this.gl || !this.canvas || !this.canvas.parentElement) { 
            return; 
        }
    
        const parentSidebar = this.canvas.parentElement; // This is .left-sidebar
        const parentSidebarRect = parentSidebar.getBoundingClientRect();
    
        // Simple approach: use the sidebar's actual rendered dimensions
        const availableWidth = parentSidebarRect.width;
        const availableHeight = parentSidebarRect.height;
    
        if (availableWidth === 0 || availableHeight === 0) { 
            return; 
        }
    
        const dpr = window.devicePixelRatio || 1;
        
        const dw = availableWidth;
        const dh = availableHeight;
    
        const bw = Math.round(dw * dpr);
        const bh = Math.round(dh * dpr);
    
        if (this.canvas.width !== bw || this.canvas.height !== bh) {
            this.canvas.width = bw;  // drawing buffer width
            this.canvas.height = bh; // drawing buffer height
            
            this.canvas.style.width = `${dw}px`;  // CSS display width
            this.canvas.style.height = `${dh}px`; // CSS display height
            
            this.gl.viewport(0, 0, bw, bh);
            console.log(`MFF Resized: CSS(${dw}x${dh}), Buffer(${bw}x${bh})`);
        }
    }   
    setupResizeHandler(){let t;const h=()=>{if(this.valid)this.resizeCanvas();};window.addEventListener('resize',()=>{clearTimeout(t);t=setTimeout(h,50);});}
    setupContextHandlers(){this.canvas.addEventListener('webglcontextlost',(e)=>{console.warn('MFF context lost.');e.preventDefault();this.valid=false;},false);this.canvas.addEventListener('webglcontextrestored',()=>{console.info('MFF context restored.');this.valid=true;this.initGL();if(this.program)this.animate();},false);}
}