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
        // Add other document properties if needed
        documentElement: {},
        head: {},
        body: {}
    };

    // Mock window properties that Three.js uses
    global.window = global;
    window.devicePixelRatio = 1;
    window.innerWidth = canvas.width;
    window.innerHeight = canvas.height;
    // Mock navigator for Three.js
    if (typeof window.navigator === 'undefined') {
        window.navigator = { userAgent: 'Node.js' };
    } else {
        try {
            window.navigator.userAgent = 'Node.js';
        } catch (e) {
            // If we can't set userAgent, we leave it as is and hope for the best.
        }
    }
    // Add missing window event listeners that Three.js/Arena expects
    window.addEventListener = () => {};
    window.removeEventListener = () => {};
    // Mock requestAnimationFrame and cancelAnimationFrame
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
    // Mock performance.now
    if (!window.performance) {
        window.performance = { now: () => Date.now() };
    } else if (!window.performance.now) {
        window.performance.now = () => Date.now();
    }

    // Patch fetch to handle file:// URLs for loading .mflpack files
    console.log('Fetch patch installed for file:// URLs');
    const originalFetch = global.fetch;
    global.fetch = async (input, init) => {
        let url = input;
        if (typeof input === 'object' && input instanceof URL) {
            url = input.href;
        }
        if (typeof url === 'string' && url.startsWith('file://')) {
            console.log(`Intercepted file:// URL: ${url}`);
            try {
                const path = new URL(url).pathname;
                // On Windows, remove leading slash if path starts with '/' and second char is a letter?
                // But we are on Linux, so fine.
                const buffer = await fs.readFile(path);
                console.log(`Read ${buffer.length} bytes from ${path}`);
                // Return a Response object (Node.js has global Response from undici)
                return new Response(buffer);
            } catch (err) {
                console.error(`Failed to read file:// URL: ${url}`, err);
                // If file not found, let original fetch handle it (will throw)
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
            // Simulate food scent by activating ORN_VA6 sensory neurons (both sides)
            if (lab.brain.setInput) {
                lab.brain.setInput('ORN_VA6_L', 1.0);
                lab.brain.setInput('ORN_VA6_R', 1.0);
            }
        } },
    { name: 'Looming Hazard', setup: (lab) => {
            // Simulate looming stimulus by activating LPLC2 sensory neurons (both sides)
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
    // Set the specific genotype
    lab.mintNewFly(genotypeSpec);
    // Apply scenario setup
    setupFn(lab);

    // Run simulation for 500 ticks at the brain's tick rate
    const dt = 1 / lab.brain.tickHz;
    for (let i = 0; i < 500; i++) {
        lab.brain.step(dt);
    }

    // Collect calibrated readings
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

            // Create lab instance for this run
            const packUrl = `file://${process.cwd()}/packs/courtship.mflpack`;
            console.log(`  Using packUrl: ${packUrl}`);
            const lab = new MadFlyLab({
                mode: 'pruned-subgraph',
                canvas: '#offscreen-canvas', // headless
                circuit: 'courtship',
                packUrl: packUrl,
                observer: false // disable observer for headless runs
            });

            // Initialize the lab (loads pack, sets up runtime, etc.)
            await lab.start();

            // Run scenario and collect data
            const controlReadings = await runScenario(lab, genotype.spec, scenario.name, scenario.setup);

            // Store results
            results.push({
                scenario: scenario.name,
                genotype: genotype.name,
                readings: controlReadings
            });

            // Clean up
            await lab.stop();
        }

        console.log(''); // blank line between scenarios
    }

    // Print summary table
    console.log('📊 BATCH RUN SUMMARY');
    console.log('='.repeat(80));

    // Group by scenario for delta calculation
    const byScenario = {};
    for (const result of results) {
        if (!byScenario[result.scenario]) {
            byScenario[result.scenario] = {};
        }
        byScenario[result.scenario][result.genotype] = result.readings;
    }

    // Calculate and display deltas (mutant vs wild-type)
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

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { runScenario, SCENARIOS, GENOTYPES, NEURONS };