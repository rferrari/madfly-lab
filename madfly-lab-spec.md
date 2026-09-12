# 🪰 MadFly Lab (`mad-fly-lab`) Framework Specification
> **An Unhinged 3D Connectome Sandbox for Building Mad Insect Brain Experiences**

---

## 1. 🎯 Executive Summary & Core Philosophy

Existing Drosophila connectomics projects are heavily fragmented across custom tech stacks:
* **`duckfly`** binds neural signals to microduck robot physics and joint controllers [81, 83].
* **`flygym` / `NeuroMechFly`** focuses on complex MuJoCo leg/joint biomechanics [65, 76].
* **`sopa.fly`** uses 2D Pygame scatter plots and grid matrices [111, 115].
* **`fly-wirehead`** runs a 166.7k-neuron C++ engine behind a fixed video screen [99, 102].
* **`FlyRizz`** prunes the connectome down to an 8.6k courtship subgraph for web hosting [30, 31].

**`mad-fly-lab`** decouples **Infrastructure & Brain Diagnostics** from **Experience Logic**. 
Developers and AI agents no longer need to rebuild WebGL viewports, camera rigs, compound visual retinas, or 3D brain visualizers. They simply drop 3D interactive stations into the lab, hook up neural signals, and focus purely on creating wild, unhinged experiences.

---

## 2. 🏗️ High-Level System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MADFLY LAB FRAMEWORK                            │
├────────────────────────────────────────────────────────────────────────┤
│  [3D Sandbox Arena]   │  [Kinematic Sensor-Block]│ [Dual Brain Engine] │
│  • Three.js Viewport  │  • Retinal Compound Eye  │ • Full (165k Graph) │
│  • Station Spawner    │  • Olfactory Glomeruli   │ • Pruned Subgraph   │
│  • Spatial Gradients  │  • Kinematic Locomotion  │   (300–8.6k Nodes)  │
├───────────────────────┴──────────────────────────┴─────────────────────┤
│                    [Unified Diagnostics Dashboard]                     │
│  • Live Retinal View  │  • 3D Soma Point-Cloud   │ • Dopamine/Motor HUD│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 🧩 Core Modules & Components

### 3.1. 🧊 Kinematic Sensor-Block Avatar (`LabAvatar`)
Instead of simulating complex 3D leg joint dynamics, the default agent is a lightweight, kinematically driven **Sensor-Block** (or optional low-poly 3D fly mesh):
* **Retinal Compound Eye (`R1–R6` / `R8`):** Hexagonal vision sampler converting 3D scene pixels into neural visual input arrays.
* **Looming Threat Detectors (`LC4` / `LPLC2`):** Computes expanding visual threat vectors [22, 134].
* **Dual Olfactory Receptors (`ORN_DM1` / `ORN_VA6`):** Samples 3D scent gradients emitted by stations [30, 112].
* **Kinematic Motor Output:** Driven directly by descending motor signals (`DNa01` steering angle, `DNp03` forward velocity, `DNp01` Giant Fiber escape jump) [11, 22, 30].

### 3.2. ⚡ Dual-Runtime Connectome Engine (`LabBrain`)
* **Mode A: Full Connectome (`165,122` Neurons / 25.58M Synapses)**
  * For local desktop/GPU environments (`fly-wirehead`, `flyhard` runtimes) [37, 99, 150].
  * Computes whole-brain spike dynamics and full 3D soma point-cloud rendering [102, 150].
* **Mode B: Pruned Subgraph (`300` – `8,600` Neurons)**
  * For browser/WASM deployment (`FlyRizz`, `sopa.fly`) [30, 31, 112].
  * Sub-millisecond execution on standard web threads without server latency [22, 81].

### 3.3. 🖥️ Visual Diagnostics HUD (`LabObserver`)
A ready-to-use 3-panel overlay:
1. **Fly Retinal Vision:** Live view of what the fly's eyes see.
2. **3D Brain Soma Point-Cloud:** Anatomical rendering of active neurons glowing by firing rate (0–200 Hz) [115, 150].
3. **Telemetry HUD:** Live sparklines for **PAM11 Dopamine Firing (Hz)**, **PPL1 Aversive Voltage**, and Motor Neuron outputs [102, 112].

---

## 4. 💻 Developer & AI Agent API (`mad-fly-lab` SDK)

Developers and AI coding agents can construct custom experiences using clean declarative code:

```javascript
import { MadFlyLab, Station, Triggers } from 'mad-fly-lab';

// Initialize the MadFly Lab Workbench
const lab = new MadFlyLab({
  mode: 'pruned-subgraph', // 'pruned-subgraph' or 'full-connectome'
  canvas: '#app-canvas',
  circuit: 'courtship-and-foraging'
});

// 1. Add a Slot Machine (Visual Blinking + Dopamine Reward)
lab.addStation(new Station.SlotMachine({
  position: [3, 0, -2],
  lightBlinkHz: 12,
  onKick: () => {
    lab.brain.injectCurrent('PAM11', +20); // +20mV dopamine surge
  }
}));

// 2. Add a Food Bowl (Olfactory Scent Field)
lab.addStation(new Station.FoodBowl({
  position: [-3, 0, 2],
  scentType: 'ORN_VA6',
  scentRadius: 5.0
}));

// 3. Add a Looming Hazard Fan (LC4 Threat Trigger)
lab.addStation(new Station.HazardFan({
  position: [0, 0, 4],
  rotationSpeed: 10,
  onLooming: (distance) => {
    lab.brain.triggerLooming('LC4', distance);
  }
}));

// Start the MadFly Lab Simulation Loop
lab.start();
```

---

## 5. 🎯 Preset Experiences Ready to Build

1. **`MadFly.Casino` (Dopamine Degenerate):** Slot machine vs. Food bowl; tracks PAM11 dopamine addiction rewiring Mushroom Body output [102, 112].
2. **`MadFly.SpeedDating` (FlyRizz 3D):** Pheromone blend matching using `ORN_DA1` / `pC1` / `DNp13` acceptance thresholds [23, 30].
3. **`MadFly.CityDriver` (Fly Drone / CARLA):** Mounting the sensor block to a vehicle and mapping `DNa01` steering to driving controls [37, 112].
4. **`MadFly.MathClass` (Mushroom Body T-Junction):** Visual equation corridors using PAM11 reward vs. PPL1 punishment plasticity [112].

---

## 6. 🤖 Guidelines for AI Agents (`AGENTS.md`)

When modifying or expanding `mad-fly-lab`:
* **Do NOT touch internal WebGL pipeline or sensor math** unless creating new hardware sensors.
* **Define new experiences inside `scenes/`** using `lab.addStation()` and `lab.brain.onSignal()`.
* **Ensure all pruned subgraphs provide fallback mock matrices** so scenes run without NeuPrint API tokens [1, 2, 113].
