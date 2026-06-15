import glob
import os
import pandas as pd
import json
from datetime import datetime, timedelta

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

def _shift_timestamp(timestamp: str, seconds: float):
    return (datetime.fromisoformat(timestamp.replace("Z", "+00:00")) + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z")

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

    # map every record to its parent so we can walk past untracked nodes (e.g. system records)
    parent_of = {r.get("uuid"): r.get("parentUuid") for r in records if r.get("uuid")}

    # a block ends at its own timestamp; it starts where the nearest preceding block ended.
    # we chain via parentUuid (skipping untracked records) instead of relying on file order.
    end_by_uuid = {}

    def start_for(parent_uuid, end_time):
        seen = set()
        current = parent_uuid
        while current and current not in seen:
            if current in end_by_uuid:
                return end_by_uuid[current]
            seen.add(current)
            current = parent_of.get(current)
        return _shift_timestamp(end_time, -10)  # no prior block: show as 10 seconds

    timeline = []
    for record in records:
        rtype = record.get("type")
        timestamp = record.get("timestamp")
        uuid = record.get("uuid")
        parent = record.get("parentUuid")
        message = record.get("message") or {}
        content = message.get("content")

        if rtype == "user" and isinstance(content, str):
            timeline.append({
                "start_time": start_for(parent, timestamp),
                "end_time": timestamp,
                "type": "user_message",
                "title": "User",
                "content": content,
            })
            end_by_uuid[uuid] = timestamp

        elif rtype == "user" and isinstance(content, list):
            # tool_result: folded into its tool_call, but keep the chain alive for the next block
            end_by_uuid[uuid] = timestamp

        elif rtype == "assistant" and isinstance(content, list):
            last_end = None
            for block in content:
                btype = block.get("type")
                if btype == "thinking":
                    blk = {"start_time": start_for(parent, timestamp), "end_time": timestamp,
                           "type": "thinking", "title": "Thinking", "content": block.get("thinking")}
                elif btype == "text":
                    blk = {"start_time": start_for(parent, timestamp), "end_time": timestamp,
                           "type": "assistant_message", "title": "Assistant", "content": block.get("text")}
                elif btype == "tool_use":
                    result = tool_results.get(block.get("id"), {})
                    end = result.get("timestamp", timestamp)
                    blk = {"start_time": start_for(parent, timestamp), "end_time": end,
                           "type": "tool_call", "title": block.get("name"),
                           "content": {"input": block.get("input"), "result": result.get("content"),
                                       "is_error": result.get("is_error", False)}}
                else:
                    continue
                timeline.append(blk)
                last_end = blk["end_time"]
            if last_end is not None:
                end_by_uuid[uuid] = last_end

        elif rtype == "attachment" and timestamp:
            attachment = record.get("attachment") or {}
            timeline.append({
                "start_time": timestamp,
                "end_time": timestamp,
                "type": "attachment",
                "title": attachment.get("type", "attachment"),
                "content": attachment.get("content"),
            })
            end_by_uuid[uuid] = timestamp

    return timeline


if __name__ == "__main__":
    sessions = get_sessions_list()
    print(json.dumps(sessions, indent=2))
