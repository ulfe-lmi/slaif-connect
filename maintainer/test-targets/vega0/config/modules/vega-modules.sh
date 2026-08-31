#!/bin/sh
if [ -r /etc/profile.d/lmod.sh ]; then
    . /etc/profile.d/lmod.sh
fi
if command -v module >/dev/null 2>&1; then
    module use /ceph/hpc/software/modulefiles >/dev/null 2>&1 || true
fi
export VEGA_CLUSTER=vega0
