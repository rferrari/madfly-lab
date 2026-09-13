# Setup & Installation

## Quick Start

```bash
make setup                       # install node + python dependencies
make packs CACHE=/path/to/.cache # build packs from the real connectome
make start                       # start Mode A server + open the lab
```

`make start` brings up the Mode A server (all 176,422 neurons, GPU if you have one), **waits for it to finish loading**, then opens the lab wired to it. That wait matters: the frontend gives a Mode A server only a few seconds before falling back to an in-tab pack, and the full connectome needs ~60–90s to load.

## All Make Targets

### Setup

| command | |
|---|---|
| `make setup` | Install node + python dependencies |
| `make setup-gpu` | Add CUDA support (optional, ~2GB) — enables GPU for Mode A |

### Development

| command | |
|---|---|
| **`make dev`** | **MODE B only** — run just the frontend with in-tab pruned pack (instant start, no server needed) |
| **`make brain`** | **MODE A only** — run just the server (all 176,422 neurons, GPU if available) |
| **`make brain-cpu`** | **MODE A CPU-only** — force CPU even if GPU is available |
| **`make start`** | **Both** — full connectome brain + frontend together (the usual one) |
| **`make start REUSE=1`** | **Both** — keep a warm brain from a previous run (saves ~90s) |
| **`make all-in`** | Rebuild packs, then start everything |

### Data & Testing

| command | |
|---|---|
| `make packs CACHE=...` | Build browser connectome packs from the real connectome |
| `make test` | Run 43 tests against real packs |
| `make check` | Run tests + production build (what CI runs) |
| `make build` | Production build into `dist/` |
| `make preview` | Serve the production build |

### Cleanup

| command | |
|---|---|
| `make stop` | Stop any running brain and frontend |
| `make clean-packs` | Delete generated packs (rebuild with `make packs`) |
| `make clean` | Remove packs, build output, and installed dependencies |

## Mode B vs Mode A

### Mode B: Browser-Only (Instant)

```bash
make dev
```

- **172 neurons to 7,638 neurons** — a pruned subgraph
- Runs in this tab instantly (~1 ms/step)
- No server, no setup, no wait
- Good for: quick development, demos, simple circuits

**Use when:** you want to start coding right away

### Mode A: Full Connectome (176,422 neurons)

```bash
make brain              # just the server
make start              # server + frontend together
make start DEVICE=gpu   # server with GPU (if available)
make start DEVICE=cpu   # server with CPU only
```

- **All 176,422 neurons, 25.7M synapses**
- Runs in Python over WebSocket (~37 ms/step CPU, 3.2 ms/step GPU)
- Takes 60–90 seconds to load
- Good for: experiments that need the full brain

**Use when:** you need every neuron

### Automatic Mode

```bash
make dev        # Falls back: tries Mode A, falls back to Mode B if no server
```

If you run `make start` (which starts the full brain), then open a second terminal and run `make dev`, it will automatically connect to the running Mode A server. If you stop the server, the browser falls back to Mode B.

## Configuration Variables

Override these when calling make:

```bash
make start CACHE=/path/to/cache         # where is connectome_*.npz?
make start CIRCUIT=dopamine             # which circuit? (default: courtship)
make start PORT=9000                    # frontend port (default: 8330)
make start DEVICE=gpu                   # gpu / cpu / auto (default: auto)
make start BRAIN_PORT=9001              # brain WebSocket port (default: 8770)
make start BRAIN_WAIT=180                # timeout waiting for brain (default: 90)
make start REUSE=1                      # keep a warm brain (default: 0)
```

Examples:

```bash
make packs CACHE=/path/to/connectome-cache
make start CIRCUIT=minimal DEVICE=gpu
make start CACHE=/path/to/cache CIRCUIT=escape PORT=8888 REUSE=1
```

## Controls

## Controls

| key | |
|---|---|
| `1`–`4` | camera: chase / orbit / fly's eye / top-down |
| `C` | cycle circuit (including `full`, which is Mode A) |
| `shift+G` | cycle genotype — blind, motion-blind, one-eyed, numb, paralysed… |
| `N` | mint a new fly (cosmetic) · `R` reset |
| `P` | poke the fly — or just click it |
| `L` lights · `B` brightness | kill or raise the lab lighting |
| `V` · `+` / `-` | brain view (rotate/front/left/right/top) and zoom |
| `H` | hide the HUD |
| `M` | room menu — free-roaming / tethered rig / chaos chair |
| `shift+R` | start/stop screen recording |
| `shift+P` | open replay modal |
| `shift+V` | export MP4 video |
| `shift+J` | export telemetry JSON |

## Building Circuits

Each circuit is a real pruned subgraph, built offline from the full connectome.

| Circuit | Neurons | gzip | Adds depth to |
|---|--:|--:|---|
| `minimal` | 5,422 | 0.6 MB | nothing — the smallest complete fly |
| `escape` | 5,833 | 0.8 MB | looming → Giant Fiber |
| `dopamine` | 6,378 | 0.8 MB | Kenyon cells, MBON, PAM / PPL1 |
| `courtship` | 6,748 | 0.9 MB | pC1/aSP hub, DNp13, dopamine |
| `full` | **176,422** | — | everything; runs on the Mode A server |

**Start with `courtship`** — it is the default, and the only circuit where
*every* station in the lab does something. The others are complete flies too,
but a `Mate` emits pheromone into a brain with no pC1/aSP hub to receive it, or
a `Screen` pays dopamine into a brain with no PAM11:

| station | minimal | escape | dopamine | courtship |
|---|:-:|:-:|:-:|:-:|
| food bowls, hazard fan, poke, walking | ✅ | ✅ | ✅ | ✅ |
| screen → PAM11 dopamine | — | — | ✅ | ✅ |
| mushroom body / learning | — | — | ✅ | ✅ |
| mate → courtship hub → DNp13 | — | — | — | ✅ |

**Every circuit contains the same sensory and motor core** — two eyes, four
glomeruli, taste, touch, and the full descending motor set including feeding.
Circuits differ by what they add depth to, never by what they are missing. A
circuit missing part of the core produces a fly that cannot function and fails
silently: the dopamine circuit once had no visual channels at all, so the fly
stood still with no error anywhere.

### Adding Custom Circuits

```bash
make packs CACHE=/path/to/connectome-cache
```

Add your own in `python/src/madfly_lab/circuits.py`. The build **fails** if a
circuit names a cell type that does not exist in the dataset, rather than
shipping a channel that silently does nothing.

## Mode A: Full Connectome Server

| aspect | details |
|---|---|
| **Where** | Python, over a WebSocket |
| **Size** | **176,422** real neurons, 25.7M synapses |
| **Speed** | ~37 ms/step CPU; GPU optional |
| **Device** | CPU or **CUDA GPU** — `--device auto` |
| **Latency** | one round trip |
| **Setup** | `npm run brain:full` |

Mode A picks its device with `--device auto` (the default): it uses a CUDA GPU
if one genuinely works and falls back to CPU with the reason printed. `--device
gpu` makes a GPU mandatory; `--device cpu` forces CPU. GPU support is an
optional extra — `uv pip install -e "python/[gpu]"`.

### GPU Setup (Optional)

```bash
make setup-gpu
```

Measured on a GTX 1650: **3.2 ms/step, 309 Hz** over the whole connectome, against 53.9 ms on the CPU — **16.7×**.

## Testing

```bash
make test
```

Runs 43 tests against real packs covering pack format, dynamics, calibration, sensors and stations. Tests run against **real generated packs**, not fixtures. If packs are missing the suite skips with a message rather than passing vacuously.

## Data & Connectome Cache

The `CACHE` directory should contain:
- `connectome_<dataset>_full.npz` (~80MB)

This file is not in the repository. Either:
1. Use `NEUPRINT_TOKEN` environment variable to fetch from NeuPrint (slow — minutes)
2. Point to a sibling project's cache
3. Generate your own from the official male-cns dataset

## Troubleshooting

**Mode A server won't start:**
- Check Python environment: `python --version` should be 3.8+
- Verify WebSocket is available: `npm run brain:full` logs the port
- Frontend waits only a few seconds; full connectome takes 60–90s to load

**GPU not being used:**
- Set `--device gpu` explicitly to force GPU and see the error
- Verify CUDA/cuDNN installation: `python -c "import cupy; print(cupy.cuda.Device())"`

**Packs won't build:**
- Check `CACHE` directory exists and contains `connectome_*.npz`
- Verify Python dependencies: `uv pip list | grep scipy`
- Look for circuit name errors in `circuits.py` — the build fails intentionally if a cell type doesn't exist

## Project Structure

```
madfly-lab/
├── src/                   # Framework source (stations, brain, HUD, etc.)
│   ├── core/              # Arena, camera, lab orchestration
│   ├── avatar/            # Fly body, sensors (retina, motion, olfaction)
│   ├── brain/             # Runtime engines (Mode A/B)
│   ├── stations/          # Interactive equipment (Screen, Fan, etc.)
│   └── observer/          # HUD, diagnostics, screen recorder
├── examples/              # Complete scenes (hello-lab, blackjack, etc.)
├── docs/                  # Documentation
├── packs/                 # Pre-built circuit packs (static assets)
├── python/                # Mode A server, circuit builder, connectome access
│   ├── scripts/           # build_pack.py, etc.
│   └── src/madfly_lab/    # Main Python module
├── tests/                 # Test suite
└── training/              # Tethered-rig training examples
```
