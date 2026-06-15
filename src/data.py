import glob
import os
import pandas as pd
import json

def parse_session_file(session_path: str):
    def parse_concatenated_json(content):
        decoder = json.JSONDecoder()
        objects = []
        idx = 0
        while idx < len(content):
            while idx < len(content) and content[idx].isspace():
                idx += 1
            if idx >= len(content):
                break
            obj, end = decoder.raw_decode(content, idx)
            objects.append(obj)
            idx = end
        return objects

    with open(session_path, "r", encoding="utf-8") as file:
        content = file.read()

    return parse_concatenated_json(content)

def get_sessions_list(return_as_json=True):
    # compute base info
    user_dir = os.path.expanduser("~")
    claude_dir = os.path.join(user_dir, ".claude", "projects")
    sessions_pattern = os.path.join(claude_dir, "*", "*.jsonl")

    session_paths = glob.glob(sessions_pattern)
    sessions_df = pd.DataFrame(session_paths)
    sessions_df.columns = ["filepath"]
    sessions_df["id"] = [os.path.basename(path).split(".")[0] for path in session_paths]
    sessions_df["project"] = [os.path.basename(os.path.dirname(path)) for path in session_paths]
    sessions_df["project"] = sessions_df["project"].str.replace("--", "-").str.replace("-", "/")

    # append titles and timestamps
    sessions_df["title"] = None
    sessions_df["creation_date"] = None
    sessions_df["last_modified"] = None
    for session in session_paths:
        try:
            records = parse_session_file(session)
        except json.JSONDecodeError as e:
            print(f"Failed to parse {session}: {e}")
            continue

        title = None
        creation_date = None
        last_modified = None
        for record in records:
            if record.get("type") == "ai-title":
                title = record.get("aiTitle")
            elif record.get("type") == "user" and creation_date is None:
                creation_date = record.get("timestamp")
            elif record.get("type") == "assistant" and record.get("timestamp"):
                last_modified = record.get("timestamp")

        mask = sessions_df["id"] == os.path.basename(session).split(".")[0]
        sessions_df.loc[mask, "title"] = title
        sessions_df.loc[mask, "creation_date"] = creation_date
        sessions_df.loc[mask, "last_modified"] = last_modified

    if return_as_json:
        return sessions_df.to_dict(orient="records")
    else:
        return sessions_df

def get_session_path(session_id: str):
    return session path

def get_session_timeline(session_id: str, response_message_index=None):
    session_data = parse_session_file(get_session_path(session_id))
    session_timeline = []
    # each event has surface level data: start_time, end_time, type, title
    def get_session_timeblocks():
        ...

    return session_timeline


if __name__ == "__main__":
    sessions = get_sessions_list()
    print(json.dumps(sessions, indent=2))
