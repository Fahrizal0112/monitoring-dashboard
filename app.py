from flask import Flask, jsonify, render_template
import psutil, os

app = Flask(__name__)
WORKSPACE = "/root/.openclaw/workspace"

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/stats")
def stats():
    cpu = psutil.cpu_percent(interval=0.5)
    ram = psutil.virtual_memory()
    disk = psutil.disk_usage("/")

    files = []
    for e in os.scandir(WORKSPACE):
        files.append({
            "name": e.name,
            "type": "folder" if e.is_dir() else "file",
            "size": round(e.stat().st_size / 1024, 2) if e.is_file() else None
        })
    files.sort(key=lambda x: (x["type"] == "file", x["name"].lower()))

    return jsonify({
        "cpu": cpu,
        "ram": {"used": round(ram.used/1024**3, 2), "total": round(ram.total/1024**3, 2), "percent": ram.percent},
        "disk": {"used": round(disk.used/1024**3, 2), "total": round(disk.total/1024**3, 2), "percent": disk.percent},
        "workspace": files
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=False)
