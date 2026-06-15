import glob
import os
import pandas as pd
import json


def get_sessions_list():
    user_dir = os.path.expanduser("~")
    claude_dir = os.path.join(user_dir, ".claude", "projects")
    sessions_pattern = os.path.join(claude_dir, "*", "*.jsonl")

    session_paths = glob.glob(sessions_pattern)
    sessions_df = pd.DataFrame(session_paths)
    sessions_df.columns = ["filepath"]
    sessions_df["id"] = [os.path.basename(path).split(".")[0] for path in session_paths]
    sessions_df["project"] = [os.path.basename(os.path.dirname(path)) for path in session_paths]
    sessions_df["project"] = sessions_df["project"].str.replace("--", "-").str.replace("-", "/")

    # parse session titles
    decoder = json.JSONDecoder()

    def parse_concatenated_json(content):
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

    sessions_df["title"] = None
    for session in session_paths:
        with open(session, "r", encoding="utf-8") as file:
            content = file.read()

        try:
            records = parse_concatenated_json(content)
        except json.JSONDecodeError as e:
            print(f"Failed to parse {session}: {e}")
            continue

        for record in records:
            if record.get("type") == "ai-title":
                mask = sessions_df["id"] == os.path.basename(session).split(".")[0]
                sessions_df.loc[mask, "title"] = record.get("aiTitle")

    return sessions_df.to_dict(orient="records")


if __name__ == "__main__":
    sessions = get_sessions_list()
    print(json.dumps(sessions, indent=2))
