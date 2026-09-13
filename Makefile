# MadFly Lab
#
#   make            show this help
#   make setup      install everything (node + python, GPU optional)
#   make packs      build the browser connectome packs
#   make dev        run the lab at http://localhost:8330
#   make brain      run only the Mode A server (all 176,422 neurons)
#   make start      brain + frontend together -- the usual one
#                   (clears stale processes first; REUSE=1 keeps a warm brain)
#   make all-in     rebuild packs first, then start
#
# CACHE points at the directory holding connectome_<dataset>_full.npz (~80MB).
# It is not in this repo. Defaults to a repo-local ./.cache (gitignored):
#   - not there yet, no token   -> falls back to the mock graph, loudly
#   - not there yet, has a token (set NEUPRINT_TOKEN in .env)
#                               -> fetches from NeuPrint, several minutes,
#                                  once -- then it IS there for every run after
#   - already there (yours, or a sibling project's) -> used as-is, no fetch
#
#   make packs CACHE=/somewhere/else/.cache   # e.g. a sibling project's cache

CACHE   ?= .cache
CIRCUIT ?= courtship
PORT    ?= 8330
DEVICE  ?= auto
PY       = python/.venv/bin/python

BRAIN_PORT ?= 8770
BRAIN_LOG  ?= /tmp/madfly-brain.log
BRAIN_PID  ?= /tmp/madfly-brain.pid
BRAIN_WAIT ?= 90          # x2 seconds before giving up on the brain
REUSE      ?= 0           # 1 = keep an already-running brain instead of restarting

.DEFAULT_GOAL := help
.PHONY: help setup setup-node setup-python setup-gpu packs dev build preview \
        brain brain-cpu start test check all-in clean clean-packs stop

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
	@# The `neuprint` extra used to be left out of the base install on the
	@# assumption that most people building packs already had a cache from a
	@# sibling project and would never hit a live fetch. That assumption does
	@# not hold for a fresh clone with nothing else on disk: NEUPRINT_TOKEN in
	@# .env would appear to do nothing, silently falling back to the mock
	@# graph, because neuprint-python itself was never installed to act on it.
	@# It is one lightweight package (unlike setup-gpu's CUDA wheels), so it is
	@# in the default install now.
	cd python && uv venv && uv pip install -e ".[neuprint]"

setup-gpu:  ## add CUDA support for the Mode A server (optional, ~2GB)
	cd python && uv pip install -e ".[gpu]"
	@$(PY) -c "from madfly_lab.device import select; select('auto')"

# ---- data -----------------------------------------------------------------

packs:  ## build all browser packs from the real connectome
	@# No hard failure on a missing CACHE dir: build_pack.py (via
	@# connectome.py's load_or_build_connectome) already handles that itself --
	@# fetch from NeuPrint if NEUPRINT_TOKEN is set (in .env or the shell),
	@# else fall back to the mock graph and say so loudly. This target used to
	@# refuse to run at all without a pre-existing cache dir, which is exactly
	@# backwards for a fresh clone: it blocked the one path that makes a
	@# from-scratch release actually work.
	cd python && $(abspath $(PY)) scripts/build_pack.py --all \
	  --cache-dir "$(abspath $(CACHE))" --out-dir ../packs

# ---- run ------------------------------------------------------------------

dev:  ## run the lab (see PORT below)
	npm run dev -- --port $(PORT)

brain:  ## Mode A server: all 176,422 neurons, GPU if available
	cd python && $(abspath $(PY)) -u -m madfly_lab.server \
	  --cache-dir "$(abspath $(CACHE))" --circuit $(CIRCUIT) --device $(DEVICE)

brain-cpu:  ## Mode A server, forced onto the CPU
	$(MAKE) brain DEVICE=cpu

start:  ## the whole lab: full-connectome brain + frontend, one command
	@# Two things this does that matter:
	@#
	@# 1. CLEARS OLD PROCESSES FIRST. A server left from an earlier run is still
	@#    serving whatever circuit and whatever CODE it started with, so edits to
	@#    circuits.py or the server appear to do nothing and you debug the wrong
	@#    binary. A stale vite also squats on the port. Both go.
	@#    `make start REUSE=1` keeps a warm brain instead (saves the ~90s load);
	@#    only do that when you have not touched the Python side.
	@#
	@# 2. WAITS for the brain before starting the frontend. `auto` mode gives a
	@#    Mode A server only a few seconds before falling back to an in-tab
	@#    pack, and the full connectome needs ~60-90s to load, so starting them
	@#    together would silently hand you the small brain every time.
	@set -e; \
	$(MAKE) --no-print-directory stop; \
	if [ "$(REUSE)" = "1" ] && ss -ltn 2>/dev/null | grep -q ':$(BRAIN_PORT)'; then \
	  echo "Mode A server already running on :$(BRAIN_PORT) -- reusing it."; \
	  started=0; \
	else \
	  if [ ! -d "$(CACHE)" ]; then \
	    echo "No cache at $(CACHE) yet -- server.py will fetch from NeuPrint if"; \
	    echo "NEUPRINT_TOKEN is set (.env or shell), else fall back to the mock"; \
	    echo "graph. A first-time fetch can run past this target's $(BRAIN_WAIT)x2s"; \
	    echo "wait; it keeps running in the background and caches for next time"; \
	    echo "even if this command falls through to the in-tab pack below."; \
	  fi; \
	  echo "Starting the full connectome (log: $(BRAIN_LOG))"; \
	  ( cd python && nohup $(abspath $(PY)) -u -m madfly_lab.server \
	      --cache-dir "$(abspath $(CACHE))" --circuit $(CIRCUIT) --device $(DEVICE) \
	      > $(BRAIN_LOG) 2>&1 & echo $$! > $(BRAIN_PID) ); \
	  started=1; \
	  printf "  loading 176,422 neurons"; \
	  for i in $$(seq 1 $(BRAIN_WAIT)); do \
	    if grep -qa "server on" $(BRAIN_LOG) 2>/dev/null; then break; fi; \
	    if grep -qaE "Traceback|Error:" $(BRAIN_LOG) 2>/dev/null; then \
	      echo; echo "  server failed to start:"; tail -15 $(BRAIN_LOG); exit 1; fi; \
	    printf "."; sleep 2; \
	  done; echo; \
	  if grep -qa "server on" $(BRAIN_LOG) 2>/dev/null; then \
	    grep -aE "device:|step cost" $(BRAIN_LOG) | sed 's/^/ /'; \
	    echo "  brain ready on ws://localhost:$(BRAIN_PORT)"; \
	  else \
	    echo "  still not ready after $$(( $(BRAIN_WAIT) * 2 ))s -- the lab will"; \
	    echo "  fall back to an in-tab pack. Check $(BRAIN_LOG)."; \
	  fi; \
	fi; \
	if [ "$$started" = "1" ]; then \
	  trap 'echo; echo "stopping the brain"; kill $$(cat $(BRAIN_PID)) 2>/dev/null || true; rm -f $(BRAIN_PID)' EXIT INT TERM; \
	fi; \
	echo; echo "Lab -> http://localhost:$(PORT)"; echo; \
	npm run dev -- --port $(PORT)

all-in: packs start  ## rebuild packs first, then `start`

stop:  ## stop any running brain and frontend
	@# Kill by LISTENING PORT, never by command-line pattern.
	@#
	@# `pkill -f <pattern>` is a trap here and it bit twice: the pattern appears
	@# in the command line of whatever shell is running the recipe, so pkill
	@# matches that shell. Exiting $$$$ only protects the CURRENT shell -- when
	@# `start` invokes `stop` as a sub-make, the pattern is still in the START
	@# recipe's command line, so `stop` killed its own caller and make reported
	@# "Terminated" before doing anything.
	@#
	@# A shell never owns a listening socket, so resolving the port's owner
	@# cannot match anything but the real server.
	@pid=$$(ss -ltnp 2>/dev/null | grep ':$(BRAIN_PORT)' \
		| grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); \
	  if [ -n "$$pid" ]; then kill $$pid 2>/dev/null || true; \
	    echo "  stopped the Mode A server (pid $$pid)"; fi
	@pid=$$(ss -ltnp 2>/dev/null | grep ':$(PORT)' \
		| grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); \
	  if [ -n "$$pid" ]; then kill $$pid 2>/dev/null || true; \
	    echo "  stopped the frontend (pid $$pid)"; fi
	@# Kill frontend on known preview and dev ports
	@for port in 5173 4173 3000; do \
	  pid=$$(ss -ltnp 2>/dev/null | grep ":$$port" \
		| grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); \
	  if [ -n "$$pid" ]; then kill $$pid 2>/dev/null || true; \
	    echo "  stopped the frontend on port $$port (pid $$pid)"; \
	  fi; \
	 done
	@rm -f $(BRAIN_PID)
	@sleep 1
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
