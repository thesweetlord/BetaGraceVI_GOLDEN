"""
Video Generation Pipeline
A decoupled, multi-stage state machine for high-fidelity 20-scene automated video generation.
"""
from .state_machine import VideoPipeline
from .config import PipelineConfig

__all__ = ["VideoPipeline", "PipelineConfig"]
