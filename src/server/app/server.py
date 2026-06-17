from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

def create_app(router: Router) -> FastAPI:
    app = FastAPI(title="agent-sim")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str]:
        return {"status": "ok"}

    return app
