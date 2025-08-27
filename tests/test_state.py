import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(__file__))

def node_eval(code):
    result = subprocess.run(
        ["node", "-e", code],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()

def test_download_dir_default():
    code = "console.log(JSON.stringify(require('./src/state.js').settings));"
    settings = json.loads(node_eval(code))
    assert settings["DownloadDir"] == "./downloads"

def test_sent_messages_empty():
    code = "const state=require('./src/state.js'); console.log(JSON.stringify(Array.from(state.sentMessages)));"
    messages = json.loads(node_eval(code))
    assert messages == []
