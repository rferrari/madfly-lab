# MadFly Lab
#
#   make            show this help
#   make setup      install everything (node + python, GPU optional)
#   make packs      build the browser connectome packs
#   make dev        run the lab at http://localhost:8330
#   make brain      run the Mode A server (all 176,422 neurons, GPU if present)
#   make all-in     packs + brain + dev, in one go
#
# CACHE points at the directory holding connectome_<dataset>_full.npz (~80MB).
# It is not in this repo -- override it if yours lives elsewhere:
#
#   make packs CACHE=/somewhere/else/.cache

CACHE   ?= ../fly_simulation/.cache
CIRCUIT ?= courtship
PORT    ?= 8330
DEVICE  ?= auto
PY       = python/.venv/bin/python

.DEFAULT_GOAL := help
.PHONY: help setup setup-node setup-python setup-gpu packs dev build preview \
        brain brain-cpu test check all-in clean clean-packs stop

help:  ## show this help
	@echo "MadFly Lab"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  CACHE=$(CACHE)"
	@echo "  CIRCUIT=$(CIRCUIT)  PORT=$(PORT)  DEVICE=$(DEVICE)"

# ---- setup ----------------------------------------------------------------

setup: setup-node setup-python  ## install node + python dependencies
	@echo
	@echo "Ready. Next: make packs CACHE=<dir with the full .npz>"

setup-node:
	npm install

setup-python:
	cd python && uv venv && uv pip install -e .

setup-gpu:  ## add CUDA support for the Mode A server (optional, ~2GB)
	cd python && uv pip install -e ".[gpu]"
	@$(PY) -c "from madfly_lab.device import select; select('auto')"

# ---- data -----------------------------------------------------------------

packs:  ## build all browser packs from the real connectome
	@test -d "$(CACHE)" || { \
	  echo "CACHE not found: $(CACHE)"; \
	  echo "Point it at the directory holding connectome_<dataset>_full.npz:"; \
	  echo "  make packs CACHE=/path/to/.cache"; exit 1; }
	cd python && $(abspath $(PY)) scripts/build_pack.py --all \
	  --cache-dir "$(abspath $(CACHE))" --out-dir ../packs

# ---- run ------------------------------------------------------------------

dev:  ## run the lab (see PORT below)
	npm run dev -- --port $(PORT)

brain:  ## Mode A server: all 176,422 neurons, GPU if available
	cd python && $(abspath $(PY)) -m madfly_lab.server \
	  --cache-dir "$(abspath $(CACHE))" --circuit $(CIRCUIT) --device $(DEVICE)

brain-cpu:  ## Mode A server, forced onto the CPU
	$(MAKE) brain DEVICE=cpu

all-in:  ## packs, then the Mode A server in the background, then the lab
	$(MAKE) packs
	@echo "starting Mode A server in the background (log: /tmp/madfly-brain.log)"
	@cd python && nohup $(abspath $(PY)) -m madfly_lab.server \
	  --cache-dir "$(abspath $(CACHE))" --circuit $(CIRCUIT) --device $(DEVICE) \
	  > /tmp/madfly-brain.log 2>&1 & echo "  pid $$!"
	@echo "  it takes ~60s to load; the lab falls back to a pack until it is up."
	$(MAKE) dev

stop:  ## stop a backgrounded Mode A server
	-pkill -f madfly_lab.server && echo "stopped" || echo "none running"

# ---- checks ---------------------------------------------------------------

test:  ## run the test suite
	npm test

build:  ## production build into dist/
	npm run build

preview: build  ## serve the production build
	npm run preview

check: test build  ## everything CI would run

# ---- cleaning -------------------------------------------------------------

clean-packs:  ## delete generated packs (rebuild with `make packs`)
	rm -f packs/*.mflpack packs/*.mflpack.gz

clean: clean-packs  ## also remove build output and installed deps
	rm -rf dist node_modules python/.venv
