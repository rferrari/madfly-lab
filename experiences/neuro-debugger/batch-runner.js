// Automated AI Neuro-Debugger: Batch Runner
// Headless control vs. mutant sweep engine for behavioral unit testing

// Mock DOM and WebGL for headless operation (using gl module for real WebGL context)
if (typeof document === 'undefined') {
    const { createCanvas } = await import('canvas');
    const glModule = (await import('gl')).default;
    const fs = await import('fs/promises');
    
    const canvas = createCanvas(100, 100);
    
    // Create a real WebGL context using the 'gl' module
    const webglContext = glModule(100, 100, { preserveDrawingBuffer: true });
    
    // Add glVersion property that Three.js expects
    webglContext.glVersion = 'WebGL 1.0';
    
    // Stub out missing methods that Three.js tries to call (texImage3D for 3D textures)
    webglContext.texImage3D = () => {};
    
    // Override the canvas's getContext method to return our WebGL context
    canvas.getContext = () => webglContext;
    // Add the missing methods that Three.js expects on the canvas
    canvas.addEventListener = () => {};
    canvas.removeEventListener = () => {};

    global.document = {
        createElement: () => canvas,
        querySelector: (selector) => {
            if (selector === '#offscreen-canvas') return canvas;
            return null;
        },
        documentElement: {},
        head: {},
        body: {}
    };

    // Mock window properties that Three.js uses
    global.window = global;
    window.devicePixelRatio = 1;
    window.innerWidth = canvas.width;
    window.innerHeight = canvas.height;
    if (typeof window.navigator === 'undefined') {
        window.navigator = { userAgent: 'Node.js' };
    } else {
        try {
            window.navigator.userAgent = 'Node.js';
        } catch (e) {
            // ignore
        }
    }
    window.addEventListener = () => {};
    window.removeEventListener = () => {};
    let animationFrameCallback = null;
    let animationFrameId = 0;
    window.requestAnimationFrame = (cb) => {
        animationFrameCallback = cb;
        return ++animationFrameId;
    };
    window.cancelAnimationFrame = (id) => {
        if (id === animationFrameId) {
            animationFrameCallback = null;
        }
    };
    if (!window.performance) {
        window.performance = { now: () => Date.now() };
    } else if (!window.performance.now) {
        window.performance.now = () => Date.now();
    }

    // Patch fetch to handle file:// URLs for loading .mflpack files
    const originalFetch = global.fetch;
    global.fetch = async (input, init) => {
        let url = input;
        if (typeof input === 'object' && input instanceof URL) {
            url = input.href;
        }
        if (typeof url === 'string' && url.startsWith('file://')) {
            try {
                const path = new URL(url).pathname;
                const buffer = await fs.readFile(path);
                return new Response(buffer);
            } catch (err) {
                return originalFetch(input, init);
            }
        }
        return originalFetch(input, init);
    };
}

// Dynamically import MadFlyLab after mock DOM setup
const { MadFlyLab } = await import('../../src/index.js');

// Define environmental scenarios
const SCENARIOS = [
    { name: 'Lights ON', setup: (lab) => { lab.arena.setLights(true); } },
    { name: 'Lights OFF', setup: (lab) => { lab.arena.setLights(false); } },
    { name: 'Food Scent', setup: (lab) => {
            if (lab.brain.setInput) {
                lab.brain.setInput('ORN_VA6_L', 1.0);
                lab.brain.setInput('ORN_VA6_R', 1.0);
            }
        } },
    { name: 'Looming Hazard', setup: (lab) => {
            if (lab.brain.setInput) {
                lab.brain.setInput('LPLC2_L', 1.0);
                lab.brain.setInput('LPLC2_R', 1.0);
            }
        } },
    { name: 'Dopamine Bath', setup: (lab) => { lab.brain.injectCurrent('PAM11', +20); } }
];

// Define genotypes to test
const GENOTYPES = [
    { name: 'wild-type', spec: 'wild-type' },
    { name: 'blind', spec: 'blind' },
    { name: 'LC4 lesioned', spec: { silence: ['LC4'] } },
    { name: 'ORN_VA6 lesioned', spec: { silence: ['ORN_VA6'] } }
];

// Key neurons to monitor (calibrated readings)
const NEURONS = [
    'DNa01',   // steering
    'DNp09',   // forward speed
    'DNp01',   // giant fiber escape
    'DNp13',   // courtship acceptance
    'DNp06'    // feeding drive
];

async function runScenario(lab, genotypeSpec, scenarioName, setupFn) {
    lab.mintNewFly(genotypeSpec);
    setupFn(lab);

    const dt = 1 / lab.brain.tickHz;
    for (let i = 0; i < 500; i++) {
        lab.brain.step(dt);
    }

    const readings = {};
    for (const neuron of NEURONS) {
        readings[neuron] = lab.brain.readCalibrated(neuron);
    }

    return readings;
}

async function main() {
    console.log('🧪 Starting Automated Neuro-Debugger Batch Sweep...\n');

    const results = [];

    for (const scenario of SCENARIOS) {
        console.log(`📋 Scenario: ${scenario.name}`);

        for (const genotype of GENOTYPES) {
            console.log(`  🔬 Testing ${genotype.name}...`);

            const packUrl = `file://${process.cwd()}/packs/courtship.mflpack`;
            const lab = new MadFlyLab({
                mode: 'pruned-subgraph',
                canvas: '#offscreen-canvas',
                circuit: 'courtship',
                packUrl: packUrl,
                observer: false
            });

            await lab.start();

            const controlReadings = await runScenario(lab, genotype.spec, scenario.name, scenario.setup);

            results.push({
                scenario: scenario.name,
                genotype: genotype.name,
                readings: controlReadings
            });

            await lab.stop();
        }

        console.log('');
    }

    console.log('📊 BATCH RUN SUMMARY');
    console.log('='.repeat(80));

    const byScenario = {};
    for (const result of results) {
        if (!byScenario[result.scenario]) {
            byScenario[result.scenario] = {};
        }
        byScenario[result.scenario][result.genotype] = result.readings;
    }

    for (const [scenario, genotypes] of Object.entries(byScenario)) {
        console.log(`\n🔬 ${scenario}:`);
        const wildType = genotypes['wild-type'];
        if (!wildType) continue;

        for (const [genotype, readings] of Object.entries(genotypes)) {
            if (genotype === 'wild-type') continue;

            console.log(`  ${genotype}:`);
            for (const neuron of NEURONS) {
                const wtVal = wildType[neuron];
                const mutVal = readings[neuron];
                const delta = mutVal - wtVal;
                console.log(`    ${neuron}: WT=${wtVal.toFixed(3)}, Mut=${mutVal.toFixed(3)}, Δ=${delta.toFixed(3)}`);
            }
        }
    }

    console.log('\n✅ Batch sweep complete!');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { runScenario, SCENARIOS, GENOTYPES, NEURONS };
