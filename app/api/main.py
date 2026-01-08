from __future__ import annotations

from fastapi import FastAPI

from app.api.routes_assets import router as assets_router
from app.api.routes_jobs import router as jobs_router

app = FastAPI(title="SAM-Audio API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(jobs_router)
app.include_router(assets_router)
