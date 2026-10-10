#!/usr/bin/env python3
"""Placeholder switch image: console notice only, no networking. See netio_sim/fake_iou.py."""

import os
import sys

# Nodes run a symlink to this file from their runtime directory: resolve it to find the package.
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))

from netio_sim.fake_iou import main  # noqa: E402

main("switch")
