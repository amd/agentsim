import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from data import get_sessions_list

app = FastAPI()
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")


@app.get("/api/sessions")
def api_sessions():
    return get_sessions_list()


@app.get("/api/sessions/{session_id}")
def api_session(session_id: str):
    for session in get_sessions_list():
        if session["id"] == session_id:
            return session
    raise HTTPException(status_code=404, detail="session not found")


@app.get("/")
def index():
    return FileResponse(os.path.join(BASE_DIR, "templates", "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

