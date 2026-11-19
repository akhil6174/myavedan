"""MyAvedan ingestion pipeline.

Stages (see docs/WORKFLOW.md and the build blueprint):
  01 registry  02 discover  03 fetch + fingerprint  04 classify + link  05 parse/OCR
  06 section map  07 AI extraction  08 grounding check  09 validate  → Ingest API

Deterministic stages are implemented and tested now. Network and AI stages land in M3.
"""

__version__ = "0.1.0"
