import os
import sys
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from data import get_sessions_list, get_session_timeline, get_session_path

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


@app.get("/api/sessions/{session_id}/timeline")
def api_session_timeline(session_id: str):
    try:
        return get_session_timeline(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="session not found")


@app.post("/api/sessions/{session_id}/open")
def api_open_session(session_id: str):
    try:
        path = os.path.normpath(get_session_path(session_id))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="session not found")

    if sys.platform.startswith("win"):
        subprocess.Popen(["explorer", "/select,", path])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path)])
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(os.path.join(BASE_DIR, "templates", "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

