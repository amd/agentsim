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
    user_dir = os.path.expanduser("~")
    claude_dir = os.path.join(user_dir, ".claude", "projects")
    matches = glob.glob(os.path.join(claude_dir, "*", session_id + ".jsonl"))
    if not matches:
        raise FileNotFoundError(f"session {session_id} not found")
    return matches[0]

def get_session_timeline(session_id: str):
    records = parse_session_file(get_session_path(session_id))

    # index tool results by tool_use_id so each tool call can find its output + end time
    tool_results = {}
    for record in records:
        message = record.get("message") or {}
        content = message.get("content")
        if record.get("type") == "user" and isinstance(content, list):
            for block in content:
                if block.get("type") == "tool_result":
                    tool_results[block.get("tool_use_id")] = {
                        "timestamp": record.get("timestamp"),
                        "content": block.get("content"),
                        "is_error": block.get("is_error", False),
                    }

    # flatten user/assistant messages and tool calls into ordered timeline blocks
    timeline = []
    for record in records:
        rtype = record.get("type")
        timestamp = record.get("timestamp")
        message = record.get("message") or {}
        content = message.get("content")

        if rtype == "user":
            if isinstance(content, str):
                timeline.append({
                    "start_time": timestamp,
                    "end_time": None,
                    "type": "user_message",
                    "title": "User",
                    "content": content,
                })
            # tool_result blocks are attached to their tool call below, so skip here

        elif rtype == "assistant" and isinstance(content, list):
            for block in content:
                btype = block.get("type")
                if btype == "thinking":
                    timeline.append({
                        "start_time": timestamp,
                        "end_time": None,
                        "type": "thinking",
                        "title": "Thinking",
                        "content": block.get("thinking"),
                    })
                elif btype == "text":
                    timeline.append({
                        "start_time": timestamp,
                        "end_time": None,
                        "type": "assistant_message",
                        "title": "Assistant",
                        "content": block.get("text"),
                    })
                elif btype == "tool_use":
                    result = tool_results.get(block.get("id"), {})
                    timeline.append({
                        "start_time": timestamp,
                        "end_time": result.get("timestamp", timestamp),
                        "type": "tool_call",
                        "title": block.get("name"),
                        "content": {
                            "input": block.get("input"),
                            "result": result.get("content"),
                            "is_error": result.get("is_error", False),
                        },
                    })

    # fill missing end times (messages/thinking) with the next block's start time
    for i, block in enumerate(timeline):
        if block["end_time"] is None:
            block["end_time"] = timeline[i + 1]["start_time"] if i + 1 < len(timeline) else block["start_time"]

    return timeline


if __name__ == "__main__":
    sessions = get_sessions_list()
    print(json.dumps(sessions, indent=2))
